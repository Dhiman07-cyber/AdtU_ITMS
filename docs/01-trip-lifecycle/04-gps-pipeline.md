# GPS Telemetry Pipeline & Client Ingestion Guards

## 1. Overview & Dual-Path Philosophy

Tracking high-frequency bus coordinates in an educational transport system involves competing trade-offs:
- **Low Latency (<100ms)**: Students tracking an arriving bus require smooth vehicle movement on MapLibre maps without buffering lag.
- **Physical Accuracy & Security**: Bad GPS sensors (null island, teleport jumps, erratic speeds) and forged telemetry must be rejected before reaching other passengers or database logs.
- **Database Scalability**: Streaming 50 buses at 1Hz produces 3,000 writes/minute. Writing every raw coordinate to PostgreSQL would exhaust database connection pools and bloat storage.

ITMS solves this with a **Dual-Path Ingestion Pipeline**:

```
                                      GPS TELEMETRY PIPELINE
                                      
               [ Driver Mobile App ]
                         │
        ┌────────────────┴────────────────┐
        ▼                                 ▼
   [ Path A: WebSocket Push ]        [ Path B: HTTP POST /api/location/update ]
   - Sub-50ms latency                - Authoritative security boundary
   - Fast client distribution        - Validates physical bounds & speeds
   - In-memory session check         - Prevents sensor jumps & null island
        │                            - Throttled DB write (1 write / 30s)
        │                            - Throttled Heartbeat (1 write / 20s)
        ▼                                 │
   [ Redis ws:broadcast ]                 ▼
        │                            [ GPS Pipeline Service ]
        └──────────────┬──────────────────┘
                       │
                       ▼
             [ Client Packet Guard ]
             - Rejects ended trips
             - Monotonic timestamps (5s skew tolerance)
             - Smooth MapLibre coordinate animation
```

---

## 2. Server-Side Validation Pipeline (`src/domains/gps/services/gps-pipeline.service.ts`)

Every incoming location update processed via the authoritative pipeline runs through sequential validation stages:

### 2.1 Bounds & Accuracy Verification
- **Null Island Check**: `(lat === 0 && lng === 0)` coordinates caused by uninitialized GPS hardware are rejected.
- **Accuracy Threshold**: Coordinates with horizontal accuracy worse than **150 meters** are discarded.
- **Speed Cap**: Raw speeds exceeding **200 km/h** are rejected as sensor glitches.

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

### 2.2 Jump Detection & Calculated Velocity
Using the spherical Haversine formula, the pipeline measures distance between the incoming coordinate and the last accepted position (`inMemoryLastLocations`):
- **Distance Jump**: Distance exceeding **5,000 meters** between consecutive pings is rejected.
- **Velocity Check**: If elapsed time is valid, calculated velocity ($distance / time$) must not exceed 200 km/h.

```typescript
// src/domains/gps/services/gps-pipeline.service.ts
const MAX_JUMP_METERS = 5000;

function validateJump(n: LocationUpdateNormalized, last: LastLocation): string | null {
  const lastTime = new Date(last.timestamp).getTime();
  const timeDiff = (n.timestamp.getTime() - lastTime) / 1000;

  // Reject out-of-order packets
  if (timeDiff < 0) return 'Out-of-order GPS packet (older than last accepted location)';

  const distance = haversine(Number(last.lat), Number(last.lng), n.lat, n.lng);

  if (distance > MAX_JUMP_METERS) {
    return `Location jump too large (${Math.round(distance)}m)`;
  }

  if (distance > 100 && timeDiff > 0.5) {
    const calculatedSpeedMps = distance / timeDiff;
    const maxSpeedMps = MAX_SPEED_KMH / 3.6;
    if (calculatedSpeedMps > maxSpeedMps) {
      const calculatedKmh = Math.round(calculatedSpeedMps * 3.6);
      return `Calculated speed ${calculatedKmh} km/h exceeds limit (${MAX_SPEED_KMH} km/h)`;
    }
  }

  return null;
}
```

---

## 3. Database Write Throttling & Heartbeat Extension

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
// Extends expires_at to now + 600s so trip lock remains valid.
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
      lat: Number(lat), lng: Number(lng),
      timestamp: new Date().toISOString(),
    }, { onConflict: 'bus_id' });
}
```

---

## 4. Client-Side Packet Guard (`src/domains/realtime/location-packet-guard.ts`)

Web browsers receive packets over WebSockets that may occasionally arrive out-of-order due to cell-tower handoffs or network jitter. The client-side packet guard evaluates incoming frames prior to updating the MapLibre marker:

```typescript
// src/domains/realtime/location-packet-guard.ts

export function decideLocationPacket(
  packet: TripPacket,
  state: TripGuardState
): TripPacketDecision {
  const incomingTsMs = parseTimestampMs(packet.timestamp);

  // 1. Permanent rejection for tombstoned trips
  if (state.endedTripId && packet.tripId && packet.tripId === state.endedTripId) {
    return { apply: false, rejectReason: 'ended-trip', ... };
  }

  // 2. Cross-trip auto-adoption with staleness check
  if (state.activeTripId && packet.tripId && packet.tripId !== state.activeTripId) {
    if (incomingTsMs > 0 && incomingTsMs + 5000 < state.lastTimestampMs) {
      return { apply: false, rejectReason: 'cross-trip-stale', ... };
    }
    // Adopt new trip
    state.activeTripId = packet.tripId;
    state.endedTripId = null;
  }

  // 3. Monotonic ordering guard with 5000ms clock skew tolerance
  const SKEW_TOLERANCE_MS = 5000;
  if (incomingTsMs > 0 && state.lastTimestampMs > 0 && incomingTsMs + SKEW_TOLERANCE_MS < state.lastTimestampMs) {
    return { apply: false, rejectReason: 'stale-timestamp', ... };
  }

  if (incomingTsMs > 0) {
    state.lastTimestampMs = Math.max(state.lastTimestampMs, incomingTsMs);
  }

  return { apply: true, ... };
}
```

### Key Guard Invariants:
1. **Clock Skew Tolerance (5,000ms)**: Drivers using Android devices with unsynchronized clocks or slow network queues will not have their packets discarded if timestamp drift is within 5 seconds.
2. **Trip Auto-Healing**: When a driver starts a new trip, incoming packets carrying the new `tripId` automatically reset tombstone state and resume UI tracking without requiring the student to refresh their browser.
