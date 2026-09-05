# Trip State Machine, Distributed Locks & Cleanup Invariants

## 1. The Authoritative State Machine

The lifecycle of an ITMS trip transitions through well-defined states enforced by PostgreSQL transactions and table constraints:

```
     ┌───────────────────────────┐
     │         SCHEDULED         │
     │  (Assigned to Route/Bus)  │
     └─────────────┬─────────────┘
                   │
                   ▼ Driver calls /api/trip/initiate
     ┌───────────────────────────┐
     │         INITIATED         │
     │  (Preflight Checks Pass)  │
     └─────────────┬─────────────┘
                   │
                   ▼ acquire_trip_lock RPC succeeds
     ┌───────────────────────────┐
     │          ACTIVE           │◄─────────────────────┐
     │  (Locks Held, Streaming)  │                      │
     └───────┬───────────┬───────┘                      │ Heartbeat extends
             │           │                              │ expires_at (TTL 600s)
             │           └──────────────────────────────┘
             │
             ├──► Driver calls /api/trip/end
             │    (end_trip_atomically RPC)
             │    OR
             │    Lock TTL expires (no heartbeat for 10 min)
             ▼
     ┌───────────────────────────┐
     │           ENDED           │
     │  (Locks Freed, History)   │
     └─────────────┬─────────────┘
                   │
                   ▼ cleanupTrip()
     ┌───────────────────────────┐
     │          CLEANED          │
     │  - bus_locations cleared  │
     │  - waiting_flags removed  │
     │  - in-memory map cleared  │
     └───────────────────────────┘
```

---

## 2. Distributed Locking with PostgreSQL RPCs

To prevent split-brain conditions where two drivers attempt to operate the same bus simultaneously, the system uses single-statement transactional RPCs with `SECURITY DEFINER` privileges in PostgreSQL.

### 2.1 `acquire_trip_lock`

Located in the database schema, this RPC enforces three critical constraints:
1. Locks the target row in `buses` via `SELECT ... FOR UPDATE`.
2. Verifies that no other row exists in `active_trips` with `status = 'active'` for either that `bus_id` or `driver_id`.
3. Inserts the new active trip with an initial TTL expiration (`expires_at = now() + interval '600 seconds'`).

```sql
-- PostgreSQL Distributed Lock Implementation
CREATE OR REPLACE FUNCTION public.acquire_trip_lock(
    p_driver_id TEXT,
    p_bus_id TEXT,
    p_route_id TEXT,
    p_shift TEXT,
    p_trip_id TEXT DEFAULT NULL,
    p_ttl_seconds INTEGER DEFAULT 600
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_trip_id TEXT;
    v_existing_trip RECORD;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_expires_at TIMESTAMPTZ;
BEGIN
    -- 1. Explicit row lock on the bus to serialize concurrent start requests
    PERFORM 1 FROM public.buses WHERE id = p_bus_id FOR UPDATE;

    -- 2. Check if the bus is already actively locked
    SELECT * INTO v_existing_trip
    FROM public.active_trips
    WHERE bus_id = p_bus_id AND status = 'active'
    FOR UPDATE;

    IF FOUND THEN
        -- If already locked by the same driver, return idempotently
        IF v_existing_trip.driver_id = p_driver_id THEN
            RETURN jsonb_build_object(
                'success', true,
                'trip_id', v_existing_trip.trip_id,
                'idempotent', true
            );
        ELSE
            RETURN jsonb_build_object(
                'success', false,
                'reason', 'Bus is already in an active trip by another driver',
                'error_code', 'LOCKED_BY_OTHER'
            );
        END IF;
    END IF;

    -- 3. Check if driver is already running another bus
    SELECT * INTO v_existing_trip
    FROM public.active_trips
    WHERE driver_id = p_driver_id AND status = 'active'
    FOR UPDATE;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'Driver already has an active trip on another bus',
            'error_code', 'DRIVER_ALREADY_ACTIVE'
        );
    END IF;

    -- 4. Insert authoritative active trip
    v_trip_id := COALESCE(p_trip_id, gen_random_uuid()::text);
    v_expires_at := v_now + (p_ttl_seconds || ' seconds')::INTERVAL;

    INSERT INTO public.active_trips (
        trip_id, driver_id, bus_id, route_id, shift, status,
        start_time, last_heartbeat, expires_at, created_at, updated_at
    ) VALUES (
        v_trip_id, p_driver_id, p_bus_id, p_route_id, p_shift, 'active',
        v_now, v_now, v_expires_at, v_now, v_now
    );

    RETURN jsonb_build_object('success', true, 'trip_id', v_trip_id);
END;
$$;
```

---

## 3. Atomic Trip Termination (`end_trip_atomically`)

When a driver ends a trip, `end_trip_atomically` transitions the status in PostgreSQL and releases row locks.

```sql
CREATE OR REPLACE FUNCTION public.end_trip_atomically(
    p_trip_id TEXT,
    p_driver_id TEXT,
    p_bus_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_trip RECORD;
BEGIN
    SELECT * INTO v_trip
    FROM public.active_trips
    WHERE trip_id = p_trip_id FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'reason', 'Trip not found');
    END IF;

    IF v_trip.driver_id != p_driver_id THEN
        RETURN jsonb_build_object('success', false, 'reason', 'Unauthorized driver');
    END IF;

    UPDATE public.active_trips
    SET status = 'ended',
        end_time = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE trip_id = p_trip_id;

    RETURN jsonb_build_object('success', true);
END;
$$;
```

---

## 4. Post-Trip Cleanup Pipeline (`src/domains/trip/services/trip-cleanup.service.ts`)

Once `end_trip_atomically` succeeds, the orchestrator invokes the post-trip cleanup service to purge transient state:

```typescript
// src/domains/trip/services/trip-cleanup.service.ts

export async function cleanupTrip(params: { driverId: string; busId: string; tripId: string }) {
  const supabase = getSupabaseServer();

  // 1. Delete waiting flags and notify students their flag was closed due to trip end
  const [{ data: deletedFlags }] = await Promise.all([
    supabase.from('waiting_flags')
      .delete()
      .eq('bus_id', params.busId)
      .eq('trip_id', params.tripId)
      .in('status', ['raised', 'acknowledged', 'waiting'])
      .select('id, student_uid, bus_id'),
    supabase.from('device_sessions').delete().eq('user_id', params.driverId),
  ]);

  // 2. Broadcast removal to affected students
  if (deletedFlags && deletedFlags.length > 0) {
    for (const flag of deletedFlags) {
      emitEvent(`student_${flag.student_uid}`, 'waiting_flag_removed', {
        flagId: flag.id,
        status: 'cancelled',
        reason: 'trip_ended',
      });
    }
  }

  // 3. Clear in-memory location cache and throttle breadcrumbs
  clearHistory(params.driverId);
  clearTripBreadcrumbCache(params.tripId);
}
```

### The 10-Minute Accidental Trip Rule (`trip-orchestrator.ts`)
To prevent accidental driver taps from polluting official university audit reports:
- If a trip starts and ends in **under 10 minutes**, it is treated as an accidental activation:
  - It is **omitted** from `driver_trip_history`.
  - Its active trip row and temporary state are purged cleanly.
- If a trip lasts **10 minutes or longer**, full summary records (duration, timestamps, route, and shift) are upserted into `driver_trip_history`.
