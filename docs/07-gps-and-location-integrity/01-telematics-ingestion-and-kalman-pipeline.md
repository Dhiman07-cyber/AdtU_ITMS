# Domain 07: High-Frequency Telematics Ingestion & 1D Kalman Filter Pipeline

## 1. Executive Summary & GIS Architecture

The ADTU ITMS GPS Pipeline processes continuous telemetry broadcasts from driver handsets across urban and highway corridors in Kamrup Metropolitan and rural districts. Because mobile consumer GNSS chipsets suffer from multipath interference, satellite blockage under flyovers, and cell tower triangulation jumps, raw coordinate feeds cannot be directly exposed to student maps or audit logs.

```mermaid
graph TD
    subgraph Driver Handset
        GPS[Hardware GNSS Receiver] -->|Raw Lat, Lng, Acc, Spd, Hdg| ANDROID[Driver PWA / Mobile HUD]
        ANDROID -->|POST /api/location/update every 2s| EDGE[Perimeter Proxy / API Gateway]
    end

    subgraph Telematics Ingestion & Sanity Gate
        EDGE --> NORM[gps-normalizer.service.ts]
        NORM -->|Clock Skew Check <= 30s| BOUNDS[Regional Bounding Box & Velocity Guard]
        BOUNDS -->|Pass| JUMP[Dead-Zone Recovery & Jump Guard]
    end

    subgraph Multi-Node State Coordination
        JUMP --> LUA[gps-redis-guard.ts: Atomic Lua Script]
        LUA -->|Check Monotonic Timestamp & Update| REDIS[(Redis Cluster / In-Memory State)]
        LUA -->|Fail-Closed in Prod if Redis Down| REJECT[HTTP 503 DATABASE_UNAVAILABLE]
    end

    subgraph Smoothing & Downstream Distribution
        LUA --> KALMAN[1D Kalman Filter Smoothing]
        KALMAN --> BROADCAST[WebSocket Server Broadcast: route:{id}]
        KALMAN --> DWELL[stop-dwell.service.ts: Audit Engine]
        KALMAN --> PERSIST[Throttled 15s Persistence to PostgreSQL]
    end
```

---

## 2. Ingestion Sanity & Regional Spatial Bounds

### 2.1 Regional Bounding Box & Sanity Thresholds
To prevent simulated coordinates, test devices in Europe, or "null island" `(0, 0)` fixes from corrupting the transit map, every update must strictly lie within the Assam & Northeast India bounding box (`src/domains/gps/services/gps-pipeline.service.ts`):

- **Latitude Window**: $25.0^{\circ}\text{N} \le \text{Lat} \le 28.5^{\circ}\text{N}$ (Assam, Meghalaya, southern Arunachal Pradesh).
- **Longitude Window**: $89.5^{\circ}\text{E} \le \text{Lng} \le 96.5^{\circ}\text{E}$ (Full Brahmaputra transit valley).
- **Maximum Road Velocity**: $200\text{ km/h}$ (`MAX_SPEED_KMH`).
- **Maximum Acceptable Dilution of Precision (Accuracy)**: $150\text{ meters}$ (`MAX_ACCURACY_METERS`).
- **Maximum Single-Tick Displacement**: $5,000\text{ meters}$ (`MAX_JUMP_METERS`).

### 2.2 Cellular Dead-Zone Dynamic Jump Recovery
Guwahati highway corridors feature cell dead zones where drivers may lose connectivity for up to several minutes. Rather than permanently rejecting the reconnect coordinate as a "teleportation attack," the jump validator scales permissible displacement dynamically:

$$\text{EffectiveMaxJump} = \min\left(35000\text{ m}, \max\left(5000\text{ m}, \Delta t \times \frac{120\text{ km/h}}{3.6}\right)\right)$$

```typescript
export function validateJump(n: LocationUpdateNormalized, last: LastLocation): string | null {
  const lastTime = new Date(last.timestamp).getTime();
  const timeDiff = (n.timestamp.getTime() - lastTime) / 1000;

  // Reject out-of-order packets — older than last accepted location
  if (timeDiff < 0) return 'Out-of-order GPS packet (older than last accepted location)';

  // Duplicate timestamp: only reject if coordinates changed significantly
  if (timeDiff === 0) {
    const distance = haversine(Number(last.lat), Number(last.lng), n.lat, n.lng);
    if (distance > 50) return 'Duplicate timestamp with significant coordinate jump';
    return null;
  }

  const distance = haversine(Number(last.lat), Number(last.lng), n.lat, n.lng);

  let effectiveMaxJump = MAX_JUMP_METERS;
  if (timeDiff > 90) {
    // Cellular dead-zone recovery: allow dynamic displacement up to 120 km/h over blackout duration, capped at 35km
    effectiveMaxJump = Math.min(35000, Math.max(MAX_JUMP_METERS, timeDiff * (120 / 3.6)));
  }

  if (distance > effectiveMaxJump) return `Location jump too large (${Math.round(distance)}m)`;

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

## 3. Mathematical Formulation of the 1D Kalman Smoothing Filter

To eliminate rapid position fluttering and GPS multipath noise along route lines, a discrete-time linear Kalman filter operates over successive coordinate updates.

### 3.1 State-Space Equations
The state vector $x_k$ represents the estimated coordinate (latitude or longitude) at step $k$:

1. **State Prediction (Time Update)**:
   $$\hat{x}_k^- = \hat{x}_{k-1}$$
   $$P_k^- = P_{k-1} + Q$$
   Where:
   - $\hat{x}_k^-$ is the a priori state estimate.
   - $P_k^-$ is the a priori estimate error covariance.
   - $Q$ is the process noise covariance (tuned to $Q = 0.00001$ for motor vehicle transit).

2. **Measurement Update**:
   $$K_k = \frac{P_k^-}{P_k^- + R}$$
   $$\hat{x}_k = \hat{x}_k^- + K_k \cdot (z_k - \hat{x}_k^-)$$
   $$P_k = (1 - K_k) \cdot P_k^-$$
   Where:
   - $z_k$ is the raw noisy GPS measurement.
   - $R$ is the measurement noise covariance, dynamically scaled by the reported hardware accuracy: $R = \max(0.0001, (\text{accuracy} / 1000)^2)$.
   - $K_k$ is the optimal Kalman gain.
   - $\hat{x}_k$ is the smoothed output position.

---

## 4. Atomic Multi-Node Redis Coordination (`gps-redis-guard.ts`)

In multi-container or cluster deployments, concurrent HTTP requests from the same bus could arrive at different API nodes. The Redis Lua script guarantees strict monotonic timestamp progression and updates in a single atomic transaction:

```lua
-- LUA_GPS_GUARD
local key = KEYS[1]
local new_ts = tonumber(ARGV[1])
local new_lat = ARGV[2]
local new_lng = ARGV[3]
local new_spd = ARGV[4]
local new_hdg = ARGV[5]

local current = redis.call('HMGET', key, 'timestamp', 'lat', 'lng')
if current[1] then
  local cur_ts = tonumber(current[1])
  if new_ts <= cur_ts then
    return redis.error_reply('OUT_OF_ORDER_TIMESTAMP')
  end
end

redis.call('HMSET', key,
  'timestamp', new_ts,
  'lat', new_lat,
  'lng', new_lng,
  'speed', new_spd,
  'heading', new_hdg,
  'updated_at', ARGV[6]
)
redis.call('EXPIRE', key, 86400)
return 'OK'
```

### 4.1 Fail-Closed Security Policy (`INV-GPS-005`)
If Redis is down or experiencing a network partition in `NODE_ENV === 'production'`, `atomicGpsGuardAndUpdate()` strictly refuses to fall back to uncoordinated local process memory. It throws `DATABASE_UNAVAILABLE`, preventing split-brain coordinates across load-balanced Next.js instances.
