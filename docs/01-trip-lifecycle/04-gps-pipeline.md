# GPS Telemetry Pipeline & Client Ingestion Guards

## 1. Overview & Pipeline Philosophy

Tracking high-frequency bus coordinates in an educational transport system involves competing trade-offs:
- **Low Latency (<50ms)**: Students tracking an arriving bus require smooth vehicle movement on MapLibre maps without buffering lag.
- **Physical Accuracy & Security**: Degraded GPS sensors (null island, teleport jumps, erratic speeds) and forged telemetry must be rejected before reaching other passengers or database logs.
- **Database Scalability**: Streaming 50 buses at 1Hz produces 3,000 writes/minute. Writing every raw coordinate to PostgreSQL would exhaust database connection pools and bloat storage.

ITMS solves this with an **Authoritative Ingress & Real-Time Fan-Out Architecture**:

```
                                      GPS TELEMETRY PIPELINE
                                      
                               [ Driver Mobile App ]
                                         │
                                         ▼ [1Hz HTTPS POST]
                       [ /api/location/update or /api/driver/update-location ]
                                         │
                                         ▼
                             [ GPS Pipeline Service ]
                             - Single-device exclusivity (device_sessions)
                             - Validates physical bounds & speeds (<200 km/h)
                             - Horizontal accuracy threshold (<150m)
                             - Rejects synthetic or fallback payloads
                             - Direct PostgreSQL active_trips verification
                             - Redis atomic Lua guard (gps_guard.lua)
                                         │
                                         ├──────────────────────────┐
                                         │                          │
                        (Instant WS Fan-out)       (Throttled Persistence)
                                         │                          │
                                         ▼                          ▼
                               [ Redis ws:broadcast ]    [ Supabase PostgreSQL ]
                                         │               - Heartbeat (1 write / 20s)
                                         ▼                 extends expires_at +600s
                               [ WS Cluster (ws1/ws2) ]  - Breadcrumb (1 write / 30s)
                                         │                 upsert bus_locations
                                         ▼
                               [ Client Packet Guard ]
                               - Rejects ended trips (tombstone)
                               - Monotonic timestamps (5s skew tolerance)
                               - Smooth MapLibre coordinate animation
```

---

## 2. Server-Side Validation Pipeline ([`src/domains/gps/services/gps-pipeline.service.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/gps/services/gps-pipeline.service.ts))

Every incoming location update processed via the authoritative pipeline runs through sequential validation stages:

### 2.1 Bounds & Accuracy Verification
- **Null Island Check**: `(lat === 0 && lng === 0)` coordinates caused by uninitialized GPS hardware are rejected.
- **Accuracy Threshold**: Coordinates with horizontal accuracy worse than **150 meters** are discarded (Android GPS hardware in urban canopies frequently ranges between 80m–140m).
- **Speed Cap**: Raw speeds exceeding **200 km/h** are rejected as sensor glitches.
- **Synthetic/Fallback Rejection**: Payloads flagged with `isFallback: true` or `source === 'fallback'` are rejected.

```typescript
// src/domains/gps/services/gps-pipeline.service.ts
const MAX_SPEED_KMH = 200;
const MAX_ACCURACY_METERS = 150;

function validateBounds(n: LocationUpdateNormalized): string | null {
  if (!Number.isFinite(n.lat) || !Number.isFinite(n.lng)) return 'Valid latitude and longitude are required';
  if (n.lat === 0 && n.lng === 0) return 'GPS fix not acquired (null island coordinates)';
  if (n.lat < -90 || n.lat > 90 || n.lng < -180 || n.lng > 180) return 'Coordinates are out of range';
  if (n.speed !== null && (n.speed < 0 || n.speed > MAX_SPEED_KMH)) return `Speed exceeds limit (${MAX_SPEED_KMH} km/h)`;
  if (n.heading !== null && (n.heading < 0 || n.heading > 360)) return 'Heading is out of range';
  if (n.accuracy !== null && (n.accuracy < 0 || n.accuracy > MAX_ACCURACY_METERS)) {
    return `GPS accuracy (${Math.round(n.accuracy)}m) exceeds threshold (${MAX_ACCURACY_METERS}m)`;
  }
  return null;
}
```

### 2.2 Direct Positive Trip Authority ([`src/domains/gps/services/gps-persistence.service.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/gps/services/gps-persistence.service.ts))

Positive trip validity is **always** verified directly against authoritative PostgreSQL `active_trips`. To prevent stale positive state across application instances, only negative lookups are cached (2-second TTL):
```typescript
// src/domains/gps/services/gps-persistence.service.ts
export async function checkActiveTrip(driverId: string, busId: string, tripId: string): Promise<{ valid: boolean; reason?: string }> {
  const cacheKey = `${driverId}:${busId}`;
  const now = Date.now();

  const negativeUntil = negativeLockCache.get(cacheKey);
  if (negativeUntil && (now < negativeUntil)) {
    return { valid: false, reason: 'No active trip lock found for this driver/bus' };
  }

  const supabase = getSupabaseServer();
  const { data: activeTrip, error } = await supabase
    .from('active_trips')
    .select('trip_id, route_id, driver_id, status, expires_at')
    .eq('bus_id', busId)
    .eq('driver_id', driverId)
    .eq('status', 'active')
    .maybeSingle();

  if (error || !activeTrip) {
    negativeLockCache.set(cacheKey, now + NEGATIVE_CACHE_TTL_MS);
    return { valid: false, reason: 'No active trip lock found for this driver/bus' };
  }

  if (activeTrip.expires_at && new Date(activeTrip.expires_at).getTime() <= now) {
    negativeLockCache.set(cacheKey, now + NEGATIVE_CACHE_TTL_MS);
    return { valid: false, reason: 'Active trip lock has expired' };
  }

  if (tripId && activeTrip.trip_id !== tripId) {
    return { valid: false, reason: 'Trip mismatch for location update' };
  }

  negativeLockCache.delete(cacheKey);
  return { valid: true };
}
```
This guarantees that the instant `end_trip_atomically` deletes the row in PostgreSQL, every serverless node immediately rejects subsequent incoming GPS updates.

---

## 3. Distributed Redis Lua Guard ([`src/domains/gps/services/gps-redis-guard.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/gps/services/gps-redis-guard.ts))

To ensure spatial consistency across multiple Next.js container instances, coordinates are evaluated atomically inside Redis using Lua:

- **Key**: `gps:last:<busId>` (HASH containing `lat`, `lng`, `ts`, `rawTs`, TTL 20 min).
- **Atomic Operations in `LUA_GPS_GUARD`**:
  1. **Raw Clock Replay Guard**: Compares client hardware timestamp `newRawTs < curRawTs`. Rejects replayed packets with `stale_raw`.
  2. **Timestamp Ordering Guard**: Allows 5,000ms clock skew tolerance (`newTs + 5000 < curTs`). Rejects out-of-order packets with `out_of_order`.
  3. **Haversine Jump Guard**: Rejects jumps greater than **5,000 meters** (`dist > maxJump`) with `jump`.
  4. **Duplicate Relocation Check**: If `newTs == curTs` but `dist > 50m`, rejects as `duplicate`.
  5. **Calculated Velocity Guard**: If elapsed time is valid, calculated speed ($dist / timeDiff$) exceeding 200 km/h is rejected with `speed`.
  6. **Commit & TTL Refresh**: Commits `HSET` and sets 20-minute expiration.

```lua
-- LUA_GPS_GUARD in src/domains/gps/services/gps-redis-guard.ts
local key = KEYS[1]
local newLat    = tonumber(ARGV[1])
local newLng    = tonumber(ARGV[2])
local newTs     = tonumber(ARGV[3])
local newRawTs  = tonumber(ARGV[4])
local maxJump   = tonumber(ARGV[5])
local maxSkew   = tonumber(ARGV[6])

local cur = redis.call('HMGET', key, 'lat', 'lng', 'ts', 'rawTs')
local curLat   = tonumber(cur[1])
local curLng   = tonumber(cur[2])
local curTs    = tonumber(cur[3])
local curRawTs = tonumber(cur[4])

-- Raw clock replay guard
if newRawTs > 0 and curRawTs ~= nil and newRawTs < curRawTs then
  return 'stale_raw'
end

-- Normalised timestamp ordering guard (5s skew tolerance)
if curTs ~= nil and newTs > 0 and newTs + 5000 < curTs then
  return 'out_of_order'
end

-- Haversine jump + speed guard
if curLat ~= nil and curLng ~= nil then
  local R = 6371000
  local lat1 = math.rad(curLat)
  local lat2 = math.rad(newLat)
  local dlat = math.rad(newLat - curLat)
  local dlng = math.rad(newLng - curLng)
  local sinDlat = math.sin(dlat / 2)
  local sinDlng = math.sin(dlng / 2)
  local a = sinDlat * sinDlat + math.cos(lat1) * math.cos(lat2) * sinDlng * sinDlng
  local c = 2 * math.atan(math.sqrt(a), math.sqrt(1 - a))
  local dist = R * c

  if dist > maxJump then return 'jump' end

  if curTs ~= nil and newTs > 0 and newTs == curTs then
    if dist > 50 then return 'duplicate' end
    return 'ok'
  end

  if curTs ~= nil and newTs > 0 then
    local timeDiffSec = (newTs - curTs) / 1000.0
    if dist > 100 and timeDiffSec > 0.5 then
      local speedMps = dist / timeDiffSec
      if speedMps > (200.0 / 3.6) then return 'speed' end
    end
  end
end

redis.call('HSET', key, 'lat', newLat, 'lng', newLng, 'ts', newTs, 'rawTs', clampedRaw)
redis.call('EXPIRE', key, tonumber(ARGV[8]))
return 'ok'
```

### Production Fail-Closed Semantics
In `production`, if Redis is configured but unreachable, `gps-redis-guard.ts` **fails closed** (`redis_unavailable`) rather than falling back to local memory, ensuring independent Next.js nodes do not accept conflicting split-brain coordinates.

---

## 4. Database Write Throttling & Heartbeat Extension

In [`src/app/api/location/update/route.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/location/update/route.ts), coordinates arrive every 1–2 seconds from each driver. The system separates high-frequency broadcasts from low-frequency persistence:

```typescript
// src/app/api/location/update/route.ts

// 1. Immediate in-memory WebSocket broadcast
emitEvent(`bus_location_${busId}`, 'bus_location_update', {
  busId, driverUid, lat: Number(lat), lng: Number(lng),
  accuracy, speed, heading: heading || 0,
  tripId: result.normalized?.tripId || tripId,
  timestamp: result.normalized?.timestamp?.toISOString() || new Date().toISOString(),
});

// 2. Heartbeat to PostgreSQL active_trips (throttled to 1 write / 20s per bus)
// CRITICAL: Extends expires_at to now + 600s so trip lock remains valid.
if (shouldWriteHeartbeat(busId, nowMs)) {
  const extendedExpiresAt = new Date(nowMs + 600 * 1000).toISOString();
  await supabase
    .from('active_trips')
    .update({
      last_heartbeat: new Date(nowMs).toISOString(),
      expires_at: extendedExpiresAt,
    })
    .eq('bus_id', busId)
    .eq('driver_id', driverUid)
    .eq('status', 'active');
}

// 3. Fallback position snapshot to bus_locations (throttled to 1 write / 30s per bus)
if (shouldWriteLocationBreadcrumb(normalizedTripId || busId, Date.now())) {
  await supabase
    .from('bus_locations')
    .upsert({
      bus_id: busId,
      trip_id: normalizedTripId || null,
      driver_id: driverUid,
      route_id: routeId || null,
      lat: Number(lat), lng: Number(lng),
      accuracy, speed, heading,
      timestamp: new Date().toISOString(),
    }, { onConflict: 'bus_id' });
}
```

---

## 5. Client-Side Packet Guard ([`src/domains/realtime/location-packet-guard.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/realtime/location-packet-guard.ts))

The browser evaluates incoming frames prior to updating the MapLibre marker:

```typescript
// src/domains/realtime/location-packet-guard.ts
export function decideLocationPacket(
  packet: TripPacket,
  state: TripGuardState
): TripPacketDecision {
  const incomingTsMs = parseTimestampMs(packet.timestamp);

  // 1. Permanent rejection for tombstoned trips
  if (state.endedTripId && packet.tripId && packet.tripId === state.endedTripId) {
    return rejected(state, 'ended-trip', incomingTsMs);
  }

  // 2. Cross-trip auto-adoption with staleness check
  if (state.activeTripId && packet.tripId && packet.tripId !== state.activeTripId) {
    if (incomingTsMs > 0 && incomingTsMs + 5000 < state.lastTimestampMs) {
      return rejected(state, 'cross-trip-stale', incomingTsMs);
    }
    state.activeTripId = packet.tripId;
    state.endedTripId = null;
  }

  // 3. Monotonic ordering guard with 5000ms clock skew tolerance
  const SKEW_TOLERANCE_MS = 5000;
  if (incomingTsMs > 0 && state.lastTimestampMs > 0 && incomingTsMs + SKEW_TOLERANCE_MS < state.lastTimestampMs) {
    return rejected(state, 'stale-timestamp', incomingTsMs);
  }

  if (incomingTsMs > 0) {
    state.lastTimestampMs = Math.max(state.lastTimestampMs, incomingTsMs);
  }

  return { apply: true, ... };
}
```

---

## 6. Adaptive HTTP Recovery Fallback ([`src/hooks/useBusLocation.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/hooks/useBusLocation.ts))

- When the application resumes from background (`visibilitychange` or `online`), it polls `/api/student/trip-status`.
- **Monotonic Timestamp Protection**:
  ```typescript
  const snapshotTs = parseTimestampMs(loc.timestamp);
  if (snapshotTs > lastTimestampRef.current) {
    handleBusLocationUpdate(loc);
  }
  ```
  This ensures that delayed or cached database snapshots from `bus_locations` never regress the live MapLibre vehicle marker.
