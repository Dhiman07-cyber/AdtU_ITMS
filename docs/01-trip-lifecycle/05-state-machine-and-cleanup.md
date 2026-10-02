# Trip State Machine, Distributed Locks & Cleanup Invariants

## 1. The Authoritative State Machine

The lifecycle of an ITMS trip transitions through well-defined states enforced by PostgreSQL transactions and table constraints:

```
     ┌───────────────────────────┐
     │         SCHEDULED         │
     │  (Assigned to Route/Bus)  │
     └─────────────┬─────────────┘
                   │
                   ▼ Driver calls POST /api/driver/initiate-trip
     ┌───────────────────────────┐
     │         PREFLIGHT         │
     │  (tripStartPreflight)     │
     └─────────────┬─────────────┘
                   │
                   ▼ acquire_trip_lock RPC succeeds
     ┌───────────────────────────┐
     │          ACTIVE           │◄─────────────────────┐
     │  (Locks Held, Streaming)  │                      │
     └───────┬───────────┬───────┘                      │ Heartbeat / GPS extends
             │           │                              │ expires_at (TTL 600s)
             │           └──────────────────────────────┘
             │
             ├──► Driver calls POST /api/driver/end-journey-v2
             │    (end_trip_atomically RPC)
             │    OR
             │    Cron cleanup_stale_locks (no heartbeat for 10 min)
             ▼
     ┌───────────────────────────┐
     │           ENDED           │
     │  - active_trips deleted   │
     │  - bus_locations cleared  │
     │  - driver_trip_history    │ (Only if duration >= 10 minutes)
     └─────────────┬─────────────┘
                   │
                   ▼ cleanupTrip()
     ┌───────────────────────────┐
     │          CLEANED          │
     │  - waiting_flags purged   │
     │  - device_sessions cleared│
     │  - in-memory map cleared  │
     │  - Redis GPS keys purged  │
     └───────────────────────────┘
```

---

## 2. Distributed Locking with PostgreSQL RPCs

To prevent split-brain conditions where two drivers attempt to operate the same bus simultaneously, the system uses single-statement transactional RPCs with `SECURITY DEFINER` privileges in PostgreSQL.

### 2.1 Table Constraints on `public.active_trips`
Located in [`supabase/COMPLETE_SCHEMA.sql`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/supabase/COMPLETE_SCHEMA.sql):
```sql
CREATE TABLE IF NOT EXISTS public.active_trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL UNIQUE,
  bus_id TEXT NOT NULL UNIQUE,
  driver_id TEXT NOT NULL UNIQUE,
  route_id TEXT NOT NULL,
  shift TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status = 'active'),
  start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### Core Database Invariants:
1. **Three-Way Hard Uniqueness**: `trip_id UNIQUE`, `bus_id UNIQUE`, and `driver_id UNIQUE` guarantee that no bus can have more than one driver, no driver can operate more than one bus, and no trip ID can be reused.
2. **`CHECK (status = 'active')`**: Only active trips can physically exist in `active_trips`. When a trip ends, its row is **deleted** (not marked status='ended'), freeing up the unique constraints for the next trip.

---

### 2.2 `acquire_trip_lock` ([`supabase/COMPLETE_SCHEMA.sql`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/supabase/COMPLETE_SCHEMA.sql#L1254))

```sql
CREATE OR REPLACE FUNCTION public.acquire_trip_lock(
    p_trip_id TEXT, p_bus_id TEXT, p_driver_id TEXT, p_route_id TEXT, p_shift TEXT, p_ttl_seconds INTEGER DEFAULT 600
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_expires_at TIMESTAMPTZ := NOW() + (p_ttl_seconds || ' seconds')::INTERVAL;
    v_existing RECORD;
    v_bus_status TEXT;
BEGIN
    -- 1. Idempotency Check: if this driver already holds active lock on this bus, return success
    SELECT trip_id INTO v_existing FROM active_trips
    WHERE bus_id = p_bus_id AND driver_id = p_driver_id AND status = 'active';
    IF FOUND THEN RETURN jsonb_build_object('success', true, 'tripId', v_existing.trip_id::text, 'alreadyActive', true); END IF;

    -- 2. Bus validity: bus must exist and not be inactive.
    -- Locked FOR UPDATE to prevent deactivation racing initiation (TOCTOU).
    SELECT status INTO v_bus_status FROM buses WHERE id = p_bus_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Bus not found'); END IF;
    IF v_bus_status = 'inactive' THEN RETURN jsonb_build_object('success', false, 'error', 'Bus is inactive'); END IF;

    -- 3. Stale Lock Self-Healing: purge dead rows where last_heartbeat < now - 600s
    DELETE FROM active_trips
    WHERE status = 'active' AND (bus_id = p_bus_id OR driver_id = p_driver_id)
      AND last_heartbeat < v_now - INTERVAL '600 seconds';

    -- 4. Atomic Insert with unique constraint violation trap
    BEGIN
        INSERT INTO active_trips (trip_id, bus_id, driver_id, route_id, shift, status, start_time, last_heartbeat, expires_at)
        VALUES (p_trip_id::uuid, p_bus_id, p_driver_id, p_route_id, p_shift, 'active', v_now, v_now, v_expires_at);
        RETURN jsonb_build_object('success', true, 'tripId', p_trip_id, 'alreadyActive', false);
    EXCEPTION WHEN unique_violation THEN
        SELECT trip_id, driver_id INTO v_existing FROM active_trips WHERE bus_id = p_bus_id AND status = 'active' LIMIT 1;
        IF FOUND AND v_existing.driver_id = p_driver_id THEN
            RETURN jsonb_build_object('success', true, 'tripId', v_existing.trip_id::text, 'alreadyActive', true);
        END IF;
        RETURN jsonb_build_object('success', false, 'error', 'LOCKED_BY_OTHER', 'activeDriverId', COALESCE(v_existing.driver_id, 'unknown'));
    END;
END;
$$;
```

---

## 3. Atomic Trip Termination (`end_trip_atomically`)

Located in [`supabase/COMPLETE_SCHEMA.sql`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/supabase/COMPLETE_SCHEMA.sql#L1475), this RPC executes transactional termination:

```sql
CREATE OR REPLACE FUNCTION public.end_trip_atomically(
  p_trip_id TEXT,
  p_bus_id  TEXT,
  p_driver_id TEXT,
  p_min_duration_seconds INTEGER DEFAULT 0
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_trip    RECORD;
  v_now     TIMESTAMPTZ := NOW();
  v_dur_sec INTEGER;
BEGIN
  -- 1. Select and lock active trip row
  SELECT trip_id, bus_id, driver_id, route_id, shift, start_time
    INTO v_trip
    FROM active_trips
   WHERE trip_id    = p_trip_id::uuid
     AND bus_id     = p_bus_id
     AND driver_id  = p_driver_id
     AND status     = 'active'
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'alreadyEnded', true);
  END IF;

  v_dur_sec := EXTRACT(EPOCH FROM (v_now - v_trip.start_time))::INTEGER;

  -- 2. Remove active lock and bus location atomically within the single transaction
  DELETE FROM active_trips WHERE trip_id = v_trip.trip_id;
  DELETE FROM bus_locations WHERE bus_id = p_bus_id;

  -- 3. Accidental short-trip filter: discard trips < 10 minutes (600s)
  IF v_dur_sec < p_min_duration_seconds THEN
    RETURN jsonb_build_object('success', true, 'tripId', p_trip_id, 'alreadyEnded', false, 'shortTripDiscarded', true);
  END IF;

  -- 4. Persist completed trip to history
  INSERT INTO driver_trip_history (
    trip_id, bus_id, driver_id, route_id, shift,
    status, ended_reason, start_time, end_time, duration_seconds
  ) VALUES (
    v_trip.trip_id, v_trip.bus_id, v_trip.driver_id, v_trip.route_id, v_trip.shift,
    'completed', 'completed', v_trip.start_time, v_now, v_dur_sec
  )
  ON CONFLICT (trip_id) DO NOTHING;

  RETURN jsonb_build_object('success', true, 'tripId', p_trip_id, 'alreadyEnded', false);
END;
$$;
```

---

## 4. Post-Trip Cleanup Pipeline ([`src/domains/trip/services/trip-cleanup.service.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/trip/services/trip-cleanup.service.ts))

Once `end_trip_atomically` commits in PostgreSQL, the orchestrator invokes `cleanupTrip` to purge transient state:

### Unconditional Bus-Scoped Flag Purge (Ghost Flag Elimination)
To prevent orphaned waiting flags from lingering on a bus (e.g., flags created with a null `trip_id` or before the trip ID was attached to the client), `cleanupTrip` purges all active waiting flags scoped strictly to `bus_id`:

```typescript
// src/domains/trip/services/trip-cleanup.service.ts
export async function cleanupTrip(params: {
  driverId: string;
  busId: string;
  tripId: string;
}) {
  const supabase = getSupabaseServer();

  // 1. Delete all active waiting flags on this bus unconditionally
  const [{ data: deletedFlags }] = await Promise.all([
    supabase.from('waiting_flags')
      .delete()
      .eq('bus_id', params.busId)
      .in('status', ['raised', 'acknowledged', 'waiting'])
      .select('id, student_uid, bus_id'),
    supabase.from('device_sessions').delete().eq('user_id', params.driverId),
  ]);
  invalidateCachedDeviceSession(params.driverId);

  // 2. Broadcast removal to affected students and driver channel
  if (deletedFlags && deletedFlags.length > 0) {
    const broadcastPromises: Promise<any>[] = [];

    for (const flag of deletedFlags) {
      broadcastPromises.push(
        emitEvent(`student_${flag.student_uid}`, 'waiting_flag_removed', {
          flagId: flag.id,
          studentUid: flag.student_uid,
          busId: flag.bus_id,
          status: 'cancelled',
          reason: 'trip_ended',
        }).catch((err: Error) => console.warn('[cleanupTrip] student broadcast failed:', err))
      );

      broadcastPromises.push(
        emitEvent(`waiting_flags_${flag.bus_id}`, 'waiting_flag_removed', {
          flagId: flag.id,
          studentUid: flag.student_uid,
          student_uid: flag.student_uid,
          busId: flag.bus_id,
          status: 'cancelled',
          reason: 'trip_ended',
        }).catch((err: Error) => console.warn('[cleanupTrip] bus channel broadcast failed:', err))
      );
    }

    await Promise.allSettled(broadcastPromises);
  }

  // 3. Clear in-memory GPS cache and throttle breadcrumbs
  clearHistory(params.driverId);
  clearTripBreadcrumbCache(params.tripId);
}
```

---

## 5. Cron-Based Stale Lock Recovery ([`src/app/api/cron/cleanup-stale-locks/route.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/cron/cleanup-stale-locks/route.ts))

If a driver's mobile device crashes, runs out of battery, or loses cellular connectivity permanently without ending the trip:
- The cron worker calls `cleanup_stale_locks` RPC:
  ```sql
  CREATE OR REPLACE FUNCTION cleanup_stale_locks(p_heartbeat_timeout_seconds INTEGER DEFAULT 60)
  RETURNS TABLE(cleaned_trip_id UUID, cleaned_bus_id TEXT, cleaned_driver_id TEXT) AS $$
  DECLARE v_trip RECORD;
  BEGIN
    FOR v_trip IN
      SELECT at.trip_id, at.bus_id, at.driver_id, at.route_id, at.shift, at.start_time
      FROM public.active_trips at
      WHERE at.status = 'active'
        AND at.last_heartbeat < NOW() - (p_heartbeat_timeout_seconds || ' seconds')::INTERVAL
    LOOP
      INSERT INTO public.driver_trip_history (
        trip_id, bus_id, driver_id, route_id, shift, status, ended_reason, start_time, end_time, duration_seconds
      ) VALUES (
        v_trip.trip_id, v_trip.bus_id, v_trip.driver_id, v_trip.route_id, v_trip.shift,
        'completed', 'completed_stale', v_trip.start_time, NOW(),
        GREATEST(0, EXTRACT(EPOCH FROM (NOW() - v_trip.start_time))::INTEGER)
      ) ON CONFLICT (trip_id) DO NOTHING;

      DELETE FROM public.active_trips WHERE active_trips.trip_id = v_trip.trip_id;
      RETURN QUERY SELECT v_trip.trip_id, v_trip.bus_id, v_trip.driver_id;
    END LOOP;
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
  ```
- The route handler deletes associated `waiting_flags` and `device_sessions`, clears the GPS anchor via `clearInMemoryLastLocation(cleaned_bus_id)`, and broadcasts `trip_ended` (`reason: 'heartbeat_timeout'`) on `trip-status-{busId}`.
