# GPS Telematics Pipeline, Driver HUD Geolocation & Incontrovertible Stop Dwell Proof (Forensic Truth)

**Module:** Geolocation Loop, Assam Bounding Box Validation, Kalman Filter Smoothing & Dwell Time Auditing  
**File Authority:** `src/hooks/useDriverGeolocation.ts`, `server/src/services/stop-dwell.service.ts`, `src/lib/kalman.ts`  
**Database Tables:** `stop_dwell_logs`, `trip_gps_breadcrumbs`, `routes`, `stops`  

---

# PART 4: Driver Live Tracking HUD, Geolocation Loop, WakeLock, Offline Buffering & Driver Map

### 4.1 Sub-Domain Architecture & Exact Execution Pipeline

The Driver Live Tracking interface is the mobile sensory endpoint of the ITMS telemetry pipeline. It runs in the driver's mobile browser, acquires high-precision satellite positioning frames, shields execution against aggressive mobile OS background throttling (screen sleep, incoming phone calls, tab suspension), buffers coordinates through cellular dead zones along the Brahmaputra corridor, and visualizes route waypoints and waiting student flags on an interactive vector map.

#### Driver Telemetry Acquisition & Resiliency Pipeline
```
[ Component Mount / Auth Verified ]
                 |
                 +-------------------------------------------------------------+
                 | 1. Initialize WebSocketClient(url, jwtToken)                |
                 | 2. Check Device Session: checkDeviceSession('driver_loc...')|
                 | 3. Check Active Trip: POST /api/driver/check-active-trip    |
                 +-------------------------------------------------------------+
                                 |
                     [ Active Trip Verified? ]
                    /                         \
                  YES                          NO
                   |                            \
                   v                             v
   [ Start Geolocation Loop ]          Render Inactive HUD /
   startLocationTracking()             Open "Start Trip" Modal
                   |
   +---------------+---------------+
   | navigator.geolocation         |
   | .getCurrentPosition()         |
   | - enableHighAccuracy: true    |
   | - timeout: 30000ms            |
   | - maximumAge: 0               |
   +---------------+---------------+
                   |
                   v
   +---------------+---------------+
   | navigator.geolocation         |
   | .watchPosition()              |
   | Updates:                      |
   | - currentLocation (lat, lng)  |
   | - heading (degrees)           |
   | - speed (m/s)                 |
   | - accuracy (meters)           |
   +---------------+---------------+
                   |
                   v
   [ Cadence Dispatcher: setInterval(3000ms) ]
   broadcastLocation() reads broadcastInputsRef (zero effect recreation)
                   |
                   v
          [ HTTP POST /api/location/update ]
          Headers: { Authorization: Bearer <jwt>, x-device-id: <deviceId> }
          Body: { busId, routeId, lat, lng, accuracy, speed, heading, tripId }
                   |
       +-----------+-----------+
      /                         \
  HTTP 200                    HTTP 5xx / Network Error / Offline
     |                                   |
     v                                   v
  - setIsNetworkOffline(false)        - setIsNetworkOffline(true)
  - latestOfflineCoordRef = null      - Display: "Reconnecting network — trip still active"
  - flushOfflineQueue(tripId)         - Store in latestOfflineCoordRef
                                      - enqueueOfflinePoint(point) -> localStorage
                                         |
                                         | [ Network Restored: window.onOnline ]
                                         v
                                      flushOfflineQueue(tripId) (FIFO drainage)
```

---

### 4.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Functions / Components | Callers (Who calls it) | Callees (What it calls) | State / Cache Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `src/app/driver/live-tracking/page.tsx` | `DriverLiveTrackingPage` (Default React Component) | Next.js Router (`/driver/live-tracking`) | `navigator.geolocation`, `navigator.wakeLock`, `WebSocketClient`, `authApiFetch`, `LiveTrackingDriverMap` | React state: `currentLocation`, `speed`, `accuracy`, `tripActive`, `isNetworkOffline`, `waitingFlags`, `isFullScreenMap` |
| `src/components/maps/LiveTrackingDriverMap.tsx` | `LiveTrackingDriverMap` (Default Component) | `DriverLiveTrackingPage` | `GuwahatiDriverMap` (via `next/dynamic` ssr: false), `MapErrorBoundary` | None |
| `src/components/maps/GuwahatiDriverMap.tsx` | `GuwahatiDriverMap` (Default Component) | `LiveTrackingDriverMap` | `GuwahatiMap`, Map controls, Student Queue Drawer | React state: `mapTheme`, `panelOpen`, `etaTimer` |
| `src/components/maps/GuwahatiMap.tsx` | `GuwahatiMap` (ForwardRef Component) | `GuwahatiDriverMap`, `GuwahatiBusMap` | MapLibre GL JS engine | MapLibre camera, sources, and layers |
| `src/lib/session-device-service.ts` | `getOrCreateDeviceId`, `checkDeviceSession`, `registerDeviceSession`, `heartbeatDeviceSession`, `releaseDeviceSession` | `DriverLiveTrackingPage` | `fetch('/api/driver/device-session')` | `localStorage('adtu_device_id')` |

---

### 4.3 Method-by-Method Low-Level Walkthrough

#### 1. Geolocation Loop: `startLocationTracking` & `watchPosition`
- **Source**: `src/app/driver/live-tracking/page.tsx` (Lines 345–513)
- **Primary Acquisition Options**:
  ```typescript
  {
    enableHighAccuracy: true,
    timeout: 30000,
    maximumAge: 0,
  }
  ```
- **Control Flow**:
  1. Calls `navigator.geolocation.getCurrentPosition` with high accuracy to lock the initial satellite fix.
  2. Sets `currentLocation = { lat, lng, accuracy, isFallback: false }`.
  3. Launches continuous tracking via `navigator.geolocation.watchPosition`.
  4. State Hysteresis Gates:
     - Speed update gate: `setSpeed((prev) => (Math.abs(prev - (gpsSpeed || 0)) > 0.2 ? (gpsSpeed || 0) : prev))` — filters GPS jitter when vehicle is stationary.
     - Accuracy update gate: `setAccuracy((prev) => (Math.abs(prev - gpsAccuracy) > 3 ? gpsAccuracy : prev))` — prevents rapid micro-renders.
  5. Fallback Degraded Mode (`tryLowerAccuracy`):
     - If high-accuracy watch fails with error code `2` (`POSITION_UNAVAILABLE`) or `3` (`TIMEOUT`), clears the failing watch ID and restarts with:
       `{ enableHighAccuracy: false, timeout: 15000, maximumAge: 0 }`.
     - Alerts driver via toast notification: `"GPS signal weak, switching to network location..."`.

---

#### 2. Cadence Ingress Dispatch: `broadcastLocation`
- **Cadence Interval**: 3,000ms (`setInterval(broadcastLocation, 3000)`).
- **Zero-Recreation Ref Pattern**:
  - `broadcastInputsRef.current` tracks `{ currentLocation, accuracy, speed, busData, routeData, tripId, currentUser }` on every render.
  - The interval callback `broadcastLocation` has empty/stable dependencies. It reads from `broadcastInputsRef.current`, eliminating timer thrashing and re-instantiation overhead.
- **Payload Construction**:
  ```typescript
  {
    idToken,
    deviceId,
    busId: resolvedBus,
    routeId: currentRouteId,
    lat: currentLocation.lat,
    lng: currentLocation.lng,
    accuracy: accuracy,
    speed: speed,
    heading: currentHeading,
    timestamp: currentIsoTimestamp,
    tripId: tripId,
    isFallback: false,
  }
  ```
- **HTTP Dispatch**: Sends `POST /api/location/update` with `Authorization: Bearer <idToken>` and `x-device-id: <deviceId>`.

---

#### 3. Screen Lock, Phone Call & Tab Backgrounding Resilience
- **WakeLock Management** (Lines 616–656):
  - Requests Screen Wake Lock via `navigator.wakeLock.request('screen')` as soon as `tripActive` becomes true.
  - Attaches `release` listener: If OS drops lock (e.g. system low power mode or incoming phone call), logs release.
  - `visibilitychange` Listener: When tab becomes `'visible'`, automatically re-acquires the Wake Lock.
- **Foreground Resume & Auto-Recovery** (Lines 1270–1321):
  - Listens to `document.addEventListener('visibilitychange')` and `window.addEventListener('focus')`.
  - When returning to foreground:
    1. Re-acquires screen Wake Lock.
    2. Re-establishes WebSocket connection via `wsClientRef.current.connect()` if closed.
    3. Verifies `watchIdRef.current`. If mobile OS killed the geolocation watch process while backgrounded, re-executes `startLocationTracking()`.
    4. Immediately executes an out-of-band `broadcastLocation()` ping to prevent server stale-lock timeouts.

---

#### 4. Cellular Dead-Zone Resilience & Offline Buffering
- **Failure Detection**:
  - Traps `fetch("/api/location/update")` network failures, HTTP 429, or HTTP 5xx.
  - Sets `isNetworkOffline(true)`, triggering the persistent amber UI warning banner:
    `"Reconnecting network — trip still active"`.
- **Buffering Strategy**:
  - Caches current GPS fix in `latestOfflineCoordRef.current`.
  - Appends item to `localStorage` queue via `enqueueOfflinePoint(point)` under key `'itms_offline_gps_queue'`.
- **FIFO Offline Queue Drainage (`flushOfflineQueue`)**:
  - Triggered by `window.addEventListener('online')` or by the next successful HTTP 200 response from `/api/location/update`.
  - Reads stored items from `localStorage`.
  - Iterates in FIFO order and POSTs each queued telemetry point to `/api/location/update` with authentic historic timestamps.
  - On first failure (if network drops again), retains remaining items and halts drainage.
  - On complete success, executes `localStorage.removeItem('itms_offline_gps_queue')` and sets `isNetworkOffline(false)`.

---

#### 5. Driver MapLibre Visualization (`GuwahatiDriverMap`)
- **Map Container**: Embeds `GuwahatiMap` with `restrictToGuwahati={true}` and `followBus={tripActive}`.
- **Bus Position Marker**: Renders at `{ lat: driverLocation.lat, lng: driverLocation.lng, heading: driverLocation.heading, speed, accuracy }`.
- **Waiting Student Pins**: Iterates over `waitingStudents` to construct `MapPoint[]`:
  - `kind: "waiting"`
  - `label: s.student_name`
  - `emphasis: s.status === "acknowledged" ? "secondary" : "primary"`
- **Dynamic University ETA Calculation**:
  - Calculates great-circle Haversine distance between current vehicle position and ADTU Campus coordinates (`lat: 26.2019, lng: 91.8615`).
  - Estimates remaining transit minutes: `minutes = (distanceKm / Math.max(currentSpeedKmH, 12)) * 60` (enforces 12 km/h traffic floor).
  - Refreshes ETA timer state every 15,000ms.

---

### 4.4 Exact I/O, Database Query & Redis Command Count Matrix

The operations executed by the driver tracking client during steady-state driving represent client-side I/O:

| Operation | Cadence / Trigger | Network / System Target | Cold Count | Steady-State Count |
| :--- | :--- | :--- | :--- | :--- |
| **GPS Fix Acquisition** | Continuous OS Watch | `navigator.geolocation.watchPosition` | 1 watcher registered | 0 network (OS satellite/radio) |
| **Location Ingress POST** | Every 3,000ms | `POST /api/location/update` | 1 HTTP request | 20 HTTP requests / min |
| **Device Session Heartbeat** | Every 10,000ms | `POST /api/driver/device-session` | 1 HTTP request | 6 HTTP requests / min |
| **Active Trip Safety Check** | Every 15,000ms | `POST /api/driver/check-active-trip` | 1 HTTP request | 4 HTTP requests / min |
| **Waiting Flags Poll Fallback**| Every 30,000ms | `GET /api/driver/dashboard-data` | 1 HTTP request | 2 HTTP requests / min |
| **Screen WakeLock Request** | On Mount & Foreground Resume | Browser Native WakeLock API | 1 call | 0 ongoing |
| **WebSocket Subscriptions** | On Mount | Channels: `waiting_flags_<busId>`, `driver_wait_request_<busId>` | 2 subscriptions | 0 polling (push events only) |

---

### 4.5 Verbatim Source Code from Live Codebase

#### 1. Geolocation Loop & Error Handling
*Source: `src/app/driver/live-tracking/page.tsx` (Lines 362–498)*
```typescript
    console.log("🌍 Starting GPS tracking...");

    // Try with lower accuracy first if high accuracy fails
    const tryLowerAccuracy = () => {
      console.log("🔄 Trying with lower accuracy settings...");

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude, speed: gpsSpeed, accuracy: gpsAccuracy } = position.coords;

          setCurrentLocation({ lat: latitude, lng: longitude, accuracy: gpsAccuracy });
          setSpeed(gpsSpeed || 0);
          setAccuracy(gpsAccuracy);

          console.log("✅ Location obtained (lower accuracy):", { gpsAccuracy });
          addToast("GPS tracking started (using network location)", "warning");

          // Start watching with lower accuracy
          watchIdRef.current = navigator.geolocation.watchPosition(
            (position) => {
              const { latitude, longitude, speed: gpsSpeed, accuracy: gpsAccuracy } = position.coords;

              setCurrentLocation({ lat: latitude, lng: longitude, accuracy: gpsAccuracy });
              setSpeed((prev) => (Math.abs(prev - (gpsSpeed || 0)) > 0.2 ? (gpsSpeed || 0) : prev));
              setAccuracy((prev) => (Math.abs(prev - gpsAccuracy) > 3 ? gpsAccuracy : prev));
            },
            (error) => {
              console.warn("⚠️ Watch error (lower accuracy):", error.code, error.message);
            },
            {
              enableHighAccuracy: false,
              maximumAge: 0, // Always get fresh location
              timeout: 15000, // Increased timeout for better accuracy
            }
          );
        },
        (error) => {
          console.log("💡 Network location unavailable - using default location");

          // Use default location as last resort (ADTU Campus UI display placeholder)
          const defaultLat = 26.1445;
          const defaultLng = 91.7362;
          setCurrentLocation({ lat: defaultLat, lng: defaultLng, accuracy: 500, isFallback: true } as any);
          setAccuracy(500);
          addToast("⚠️ Location access denied or unavailable. UI showing campus placeholder. Real GPS required to start broadcast.", "warning");
        },
        {
          enableHighAccuracy: false,
          timeout: 60000,
          maximumAge: 10000,
        }
      );
    };

    // First try with high accuracy
    navigator.geolocation.getCurrentPosition(
      (initialPosition) => {
        const { latitude, longitude, speed: gpsSpeed, accuracy: gpsAccuracy } = initialPosition.coords;

        // Set initial location (real device GPS)
        setCurrentLocation({ lat: latitude, lng: longitude, accuracy: gpsAccuracy, isFallback: false } as any);
        setSpeed(gpsSpeed || 0);
        setAccuracy(gpsAccuracy);

        console.log("✅ Initial location obtained (high accuracy):", { gpsAccuracy });
        addToast("GPS tracking started", "success");

        // Now start continuous tracking
        watchIdRef.current = navigator.geolocation.watchPosition(
          (position) => {
            const { latitude, longitude, speed: gpsSpeed, accuracy: gpsAccuracy, heading: gpsHeading } = position.coords;

            setCurrentLocation({ lat: latitude, lng: longitude, accuracy: gpsAccuracy, heading: gpsHeading ?? 0 } as any);
            setSpeed((prev) => (Math.abs(prev - (gpsSpeed || 0)) > 0.2 ? (gpsSpeed || 0) : prev));
            setAccuracy((prev) => (Math.abs(prev - gpsAccuracy) > 3 ? gpsAccuracy : prev));
          },
          (error) => {
            console.error("❌ Geolocation watch error:", { code: error.code, message: error.message });

            // Handle specific errors
            if (error.code === 1) { // PERMISSION_DENIED
              addToast("Location permission denied. Please allow location access.", "error");
            }
            else if (error.code === 2 || error.code === 3) { // POSITION_UNAVAILABLE or TIMEOUT
              console.log("⚠️ High accuracy watch failed, switching to lower accuracy...");

              // Clear the failing watch
              if (watchIdRef.current !== null) {
                navigator.geolocation.clearWatch(watchIdRef.current);
                watchIdRef.current = null;
              }

              // Try fallback
              tryLowerAccuracy();
            } else {
              console.warn("⚠️ GPS watch transient pause:", error.message);
            }
          },
          {
            enableHighAccuracy: true,
            timeout: 30000,
            maximumAge: 0, // Always get fresh, accurate location
          }
        );
      },
      (error) => {
        console.warn("⚠️ High accuracy geolocation unavailable:", error.code, error.message);

        if (error.code === error.PERMISSION_DENIED) {
          addToast("Location permission denied. Please enable location access in your browser.", "error");
        } else if (error.code === error.POSITION_UNAVAILABLE || error.code === error.TIMEOUT) {
          console.log(" Trying network-based location...");
          addToast("GPS unavailable, trying network location...", "warning");
          tryLowerAccuracy();
        } else {
          console.log(" GPS unavailable, using default location");
          const defaultLat = 26.1445;
          const defaultLng = 91.7362;
          setCurrentLocation({ lat: defaultLat, lng: defaultLng, accuracy: 500, isFallback: true } as any);
          setAccuracy(500);
          addToast(" GPS timeout. Map updated to campus default.", "warning");
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 30000,
        maximumAge: 0,
      }
    );
```

#### 2. Periodic Location Dispatch & Offline Enqueuing
*Source: `src/app/driver/live-tracking/page.tsx` (Lines 1188–1268)*
```typescript
  // Stable across renders (empty deps): reads the latest inputs from broadcastInputsRef so the
  // broadcast interval never needs to be recreated to pick up new GPS positions.
  const broadcastLocation = useCallback(async () => {
    const inputs = broadcastInputsRef.current;
    if (!inputs) return;
    const { currentLocation, accuracy, speed, busData, routeData, tripId, currentUser } = inputs;
    if (!currentLocation || (currentLocation as any).isFallback || !busData || !routeData) {
      if ((currentLocation as any)?.isFallback) {
        console.log("⏳ Skipping location broadcast — waiting for real device GPS fix");
      }
      return;
    }

    const resolvedBus = busData?.busId || busData?.id || selectedBusId;
    const currentHeading = (currentLocation as any).heading ?? 0;
    const currentIsoTimestamp = new Date().toISOString();
    const currentRouteId = routeData?.routeId || routeData?.id || busData?.route_id || 'unassigned';

    // Authoritative HTTP path for GPS pipeline, DB breadcrumbs, and PostgreSQL heartbeat
    // (Bypassing direct WS location stream to prevent unvalidated duplicate broadcasts)
    try {
      const idToken = await currentUser?.getIdToken();
      const deviceId = currentDeviceId.current || getOrCreateDeviceId();
      const response = await fetch("/api/location/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
          "x-device-id": deviceId,
        },
        body: JSON.stringify({
          idToken,
          deviceId,
          busId: resolvedBus,
          routeId: currentRouteId,
          lat: currentLocation.lat,
          lng: currentLocation.lng,
          accuracy: accuracy,
          speed: speed,
          // Prefer real GPS heading from device; falls back to 0 when unavailable
          // (e.g. stationary or desktop browser). Never fabricate a heading.
          heading: currentHeading,
          timestamp: currentIsoTimestamp,
          tripId: tripId,
          isFallback: false,
        }),
      });

      if (!response.ok) {
        console.warn("⚠️ Location update failed:", response.status);
        if (response.status >= 500 || response.status === 429) {
          setIsNetworkOffline(true);
        }
      } else {
        // Successful response - clear offline indicator and pending slot
        setIsNetworkOffline(false);
        latestOfflineCoordRef.current = null;
        if (tripId) {
          flushOfflineQueue(tripId);
        }
      }
    } catch (error) {
      console.warn("⚠️ Error broadcasting location (buffering offline):", error);
      setIsNetworkOffline(true);
      const point: QueuedGpsPoint = {
        tripId: tripId || 'unknown',
        busId: resolvedBus,
        routeId: currentRouteId,
        lat: currentLocation.lat,
        lng: currentLocation.lng,
        accuracy,
        speed,
        heading: currentHeading,
        timestamp: currentIsoTimestamp,
        createdAtMs: Date.now(),
      };
      // Single-slot in-memory ref for next-tick / online immediate flush
      latestOfflineCoordRef.current = point;
      if (tripId) {
        enqueueOfflinePoint(point);
      }
    }
  }, [selectedBusId, flushOfflineQueue]);
```

#### 3. Screen WakeLock Implementation
*Source: `src/app/driver/live-tracking/page.tsx` (Lines 616–656)*
```typescript
  // Screen Wake Lock API for Driver
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;

    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await navigator.wakeLock.request('screen');
          console.log('💡 Screen Wake Lock active (Driver)');

          wakeLock.addEventListener('release', () => {
            console.log('💡 Screen Wake Lock released (Driver)');
          });
        }
      } catch (err: any) {
        if (err.name !== 'NotAllowedError') {
          console.error(`❌ Wake Lock error: ${err.name}, ${err.message}`);
        }
      }
    };

    if (tripActive) {
      requestWakeLock();
    }

    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && tripActive) {
        await requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLock) {
        wakeLock.release().catch(e => console.error('Wake Lock release error', e));
        wakeLock = null;
      }
    };
  }, [tripActive]);
```

#### 4. Backgrounding & Network Recovery Listeners
*Source: `src/app/driver/live-tracking/page.tsx` (Lines 1271–1321)*
```typescript
  // Comprehensive Mobile App Resume & Lock/Unlock Auto-Recovery
  useEffect(() => {
    const handleResume = () => {
      if (document.visibilityState === 'visible') {
        console.log("📱 [MobileResume] Screen turned ON / App back in foreground — restoring state");

        // Immediately re-acquire wake lock if released by OS while sleeping
        if ('wakeLock' in navigator && tripActiveRef.current) {
          try {
            navigator.wakeLock.request('screen').then((lock) => {
              wakeLockRef.current = lock;
            }).catch(() => {});
          } catch (_) {}
        }

        // Reconnect WebSocket if disconnected during phone sleep
        if (wsClientRef.current) {
          try {
            wsClientRef.current.connect();
          } catch (_) { }
        }

        // Restart GPS watch if OS dropped it during screen off
        if (tripActiveRef.current) {
          if (watchIdRef.current === null) {
            console.log("🔄 Re-starting location tracking after screen wake...");
            startLocationTracking();
          }
          // Send immediate location / heartbeat transmission upon return
          broadcastLocation();
        }
      }
    };

    const handleOnline = () => {
      console.log("🌐 [Network] Connectivity restored — flushing buffered location");
      setIsNetworkOffline(false);
      if (tripActiveRef.current) {
        broadcastLocation();
      }
    };

    document.addEventListener('visibilitychange', handleResume);
    window.addEventListener('focus', handleResume);
    window.addEventListener('online', handleOnline);

    return () => {
      document.removeEventListener('visibilitychange', handleResume);
      window.removeEventListener('focus', handleResume);
      window.removeEventListener('online', handleOnline);
    };
  }, [broadcastLocation, startLocationTracking]);
```

---



---

## PART 6: Incontrovertible Stop Dwell Audit Engine & Route Stop Coordinate Enrichment

### 6.1 Sub-Domain Architecture & Exact Execution Pipeline

The Incontrovertible Stop Dwell Audit Engine provides mathematical proof of transit service delivery (System Invariant 2: INV-2). It establishes whether a bus visited an authorized stop, how long it stayed stationary, and whether unscheduled roadside halts occurred along the university corridor.

```
                               [ GPS Pipeline Ingress ]
                                          │
                                          │ trackStopDwell(input)
                                          ▼
                ┌──────────────────────────────────────────────────┐
                │ 1. Check Active Dwell State                      │
                │ - Read in-memory activeDwells.get(busId)         │
                │ - If missing & cruising (speed >= 5 km/h):       │
                │   Zero-Waste Highway Guard:                      │
                │   Skip Redis read if checked < 10,000ms ago      │
                │ - If stopped (< 5 km/h) or > 10s:                │
                │   Read Redis getRedisActiveDwell('dwell:active:')│
                └─────────────────────────┬────────────────────────┘
                                          │
                        ┌─────────────────┴─────────────────┐
                        ▼                                   ▼
             [ Active Dwell Exists ]             [ No Active Dwell ]
                        │                                   │
       ┌────────────────┴────────────────┐                  │
       │ Calculate Haversine to Anchor:  │                  │
       │ distToActive = Haversine(       │                  │
       │   lat, lng, stopLat, stopLng    │                  │
       │ )                               │                  │
       └────────────────┬────────────────┘                  │
                        │                                   │
      ┌─────────────────┼─────────────────┐                 │
      ▼                 ▼                 ▼                 │
[ Inside <= 80m ] [ 80m < dist <= 100m ] [ Exited > 100m ]  │
      │                 │                 │                 │
┌──────────────┐  ┌──────────────┐  ┌──────────────────┐    │
│ Accumulate   │  │ Hysteresis   │  │ Stop Completed:  │    │
│ Dwell Time:  │  │ Buffer:      │  │ 1. Delete memory │    │
│ IF speed < 5:│  │ Update       │  │ 2. DEL Redis key │    │
│ dwellSeconds │  │ lastTickMs   │  │ 3. Asynchronously│    │
│   += delta   │  │ Save memory  │  │    persist to    │    │
│ Save memory  │  │ & Redis      │  │    Supabase      │    │
│ & Redis      │  └──────────────┘  │    stop_dwell_   │    │
└──────────────┘                    │    logs          │    │
                                    └──────────────────┘    │
                                                            │
    ┌───────────────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ 2. Stop Discovery & Route Stop Enrichment                    │
│ - Resolve stops via getCanonicalStopsForRoute(routeId)        │
│ - Fallback: pgFindById(routeId) -> enrichRouteStops()         │
│   (Merges canonical dictionary coordinates into JSON stops)   │
└───────────────────────────────┬───────────────────────────────┘
                                │
        ┌───────────────────────┴───────────────────────┐
        ▼                                               ▼
[ Bus Enters Named Stop (dist <= 80m) ] [ Bus Stopped Between Stops ]
        │                                               │
┌───────────────────────────────┐       ┌───────────────────────────────┐
│ Anchor New Named Stop Dwell:  │       │ Check Roadside Halt:          │
│ - stopId = stop.stop_id       │       │ - IF speed < 5 km/h           │
│ - stopName = stop.name        │       │ - AND corridor <= 80m to road │
│ - arrivedAt = timestamp       │       │   (projectPointToRouteCorridor│
│ - dwellSeconds = 0            │       │ - stopName =                  │
│ - isRoadside = false          │       │   "Roadside Halt (near Stop)" │
│ Save memory & Redis (TTL 300s)│       │ Save memory & Redis (TTL 300s)│
└───────────────────────────────┘       └───────────────────────────────┘
```

---

### 6.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Functions / Components | Callers (Who calls it) | Callees (What it calls) | State / Cache Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `src/domains/gps/services/stop-dwell.service.ts` | `trackStopDwell`, `flushStopDwellOnTripEnd`, `clearStopDwellState`, `getActiveDwellState`, `processWaitingFlagsOnGpsTick` | `gps-pipeline.service.ts`, `trip-orchestrator.ts`, `trip-cleanup.service.ts` | `getRedisActiveDwell`, `setRedisActiveDwell`, `clearRedisActiveDwell`, `getCanonicalStopsForRoute`, `projectPointToRouteCorridor`, `pgFindById`, `supabase.from('stop_dwell_logs')` | Mutates `activeDwells` Map, Redis `dwell:active:<busId>`, inserts `stop_dwell_logs` |
| `src/domains/route/data/canonical-route-geometries.ts` | `getCanonicalStopsForRoute`, `findCanonicalStopCoordinates`, `enrichRouteStops`, `getCanonicalRouteGeometry`, `CANONICAL_ROUTE_GEOMETRIES`, `CANONICAL_ROUTE_STOPS` | `stop-dwell.service.ts`, `route.repository.pg.ts`, `route-alignment-engine.ts`, `route-corridor-projection.ts` | None | Static dictionary lookup; no mutation |
| `src/domains/route/repositories/route.repository.pg.ts` | `pgFindAll`, `pgFindById`, `pgUpdate`, `pgRemove`, `pgInsert`, `pgUpsert`, `pgFindAllNames`, `pgCount` | `stop-dwell.service.ts`, `route.service.ts`, Route API routes | `getSupabaseServer`, `enrichRouteStops` | Reads `routes` table, transforms rows via `pgRowToRoute` |
| `src/domains/route/services/route-alignment-engine.ts` | `projectPointToRouteCorridor`, `projectPointToPolyline`, `projectPointToSegment`, `haversineMeters`, `isReverseRouteDirection` | `stop-dwell.service.ts`, `waiting-flag.service.ts`, `location-packet-guard.ts` | `getCanonicalRouteGeometry`, `getCanonicalStopsForRoute` | Pure computational geometric projection |
| `src/app/api/admin/trip-dwell-logs/route.ts` | `GET` (wrapped in `withSecurity`) | `StopDwellAuditProof.tsx` | `getSupabaseServer`, `supabase.from('stop_dwell_logs')` | None (read-only query) |
| `src/components/admin/StopDwellAuditProof.tsx` | `StopDwellAuditProof` | `src/app/admin/audit-logs/page.tsx` | `fetch('/api/admin/trip-dwell-logs')` | Component local state (`logs`, `loading`, `totalCount`) |
| `src/app/admin/audit-logs/page.tsx` | `AdminAuditLogsPage` | Admin UI Navigation (`/admin/audit-logs`) | `StopDwellAuditProof` | Page tab state (`transit_dwell`) |

---

### 6.3 Method-by-Method Low-Level Walkthrough

#### 6.3.1 `trackStopDwell` (`src/domains/gps/services/stop-dwell.service.ts`)
1. **Input Parameters**:
   - Accepts `StopDwellInput`: `{ busId, tripId, driverId, routeId, lat, lng, speed, timestamp }`.
2. **Step 1: Check Active Dwell State**:
   - Queries process-local `activeDwells.get(busId)`.
   - If missing from memory:
     - Checks if vehicle is cruising: `isCruising = speed >= 5.0 km/h`.
     - **Zero-Waste Highway Guard**: If cruising and Redis was checked within the last 10,000ms (`currentMs - lastCheck < 10000`), skips Redis command entirely (0 Redis commands).
     - Otherwise, queries Redis `getRedisActiveDwell(busId)` (`dwell:active:<busId>`). If found, re-hydrates `activeDwells.set(busId, active)`.
3. **Step 2: Processing Ongoing Active Dwell**:
   - Computes Haversine distance from incoming coordinates to the anchor stop: `distToActive = haversineMeters(lat, lng, active.stopLat, active.stopLng)`.
   - **Case A: Still Inside Capture Zone (`distToActive <= 80m`)**:
     - Calculates elapsed tick time: `deltaSeconds = Math.min(30, Math.max(0, (currentMs - active.lastTickMs) / 1000))`.
     - Checks if stationary: `isStationary = speed === null || speed < 5.0 km/h`.
     - If stationary, increments dwell counter: `active.dwellSeconds += deltaSeconds`.
     - Updates `active.lastTickMs = currentMs`.
     - Saves to `activeDwells` Map and non-blocking `setRedisActiveDwell(busId, active)` (TTL 300s). Returns immediately.
   - **Case B: Hysteresis Transition Buffer (`80m < distToActive <= 100m`)**:
     - Does not accumulate stationary dwell seconds, but maintains active dwell state without completing it to prevent jitter flapping. Updates `active.lastTickMs = currentMs` and returns.
   - **Case C: Stop Exit Concluded (`distToActive > 100m`)**:
     - Vehicle has definitively departed the stop zone.
     - Deletes from `activeDwells.delete(busId)`.
     - Dispatches non-blocking Redis deletion: `clearRedisActiveDwell(busId)`.
     - Calls fire-and-forget helper: `persistDwellRecord(active, departedAtIso)`.
4. **Step 3: Discovering New Stops (When No Active Dwell Exists)**:
   - Resolves stops via `getCanonicalStopsForRoute(routeId)`. If empty or null, falls back to `pgFindById(routeId)` which enriches stops via `enrichRouteStops`.
   - **Named Stop Discovery**: Iterates through stops. Computes `dist = haversineMeters(lat, lng, stop.lat, stop.lng)`.
     - If `dist <= 80m`: Anchors new named stop dwell record (`isRoadside: false`, `dwellSeconds: 0`, `arrivedAt: timestamp`). Saves to memory and Redis. Flags `enteredNamedStop = true` and returns.
   - **Roadside Halt Discovery**: If not at a named stop, checks if bus has stopped:
     - `isStationary = speed === null || speed < 5.0 km/h`.
     - If stationary, projects coordinates onto road centerline via `projectPointToRouteCorridor({ lat, lng }, routeId, stops)`.
     - If `corridor.crossTrackDistanceMeters <= 80m`:
       - Bus is halted on the roadside along the designated transit corridor.
       - Anchors roadside dwell record under `stopName: "Roadside Halt (near ${corridor.nearestStopName})"`, `isRoadside: true`, `dwellSeconds: 0`. Saves to memory and Redis.

---

#### 6.3.2 `persistDwellRecord` (`src/domains/gps/services/stop-dwell.service.ts`)
1. **Dwell Duration Normalization**:
   - Calculates residency duration: `residencySeconds = (dwell.lastTickMs - dwell.arrivedAtMs) / 1000`.
   - Protects against urban multipath GPS speed spikes: `dwellSeconds = Math.max(dwell.dwellSeconds, residencySeconds)`.
2. **Roadside Minimum Filter**:
   - If `dwell.isRoadside === true` and `dwellSeconds < 15`: Discards the record without database insertion (filters out momentary traffic stops, red lights, and pedestrian pauses).
3. **Database Insertion**:
   - Inserts record into PostgreSQL `stop_dwell_logs`:
     - `trip_id`, `bus_id`, `driver_id`, `route_id`, `stop_id`, `stop_name`, `arrived_at`, `departed_at`, `dwell_seconds`.
   - Logged to `appLogger.info('gps', 'stop_dwell_logged', ...)`. Errors caught and logged; never throws to caller.

---

#### 6.3.3 `enrichRouteStops` (`src/domains/route/data/canonical-route-geometries.ts`)
1. **Purpose**:
   - Guarantees that even if database rows in PostgreSQL `routes.stops` contain JSON arrays with missing, null, or `0, 0` coordinates, every stop is injected with authoritative WGS84 coordinates from the canonical dictionary.
2. **Matching Cascade**:
   - Match 1: Matches canonical stop of route by normalized `stop_id` or normalized `stop_name`.
   - Match 2: Matches canonical stop by route `sequence` index.
   - Match 3: Cross-route fallback dictionary lookup via `findCanonicalStopCoordinates`.

---

#### 6.3.4 `GET /api/admin/trip-dwell-logs` (`src/app/api/admin/trip-dwell-logs/route.ts`)
1. **Access Control**:
   - Wrapped in `withSecurity({ requiredRoles: ['admin', 'moderator'], rateLimit: RateLimits.READ })`.
2. **Query Filtering**:
   - Filters by optional query parameters: `tripId`, `busId`, `routeId`, with `limit` (max 200, default 50) and `offset`.
   - If `tripId` is specified: orders by `arrived_at ASC` (chronological route progression).
   - If global: orders by `arrived_at DESC` (latest audit events first).
3. **Status Derivation**:
   - Appends derived status: `dwell_seconds >= 20 ? 'Verified Dwell' : 'Brief Pass-Through'`.
4. **Response**:
   - Returns JSON: `{ success: true, logs, total, limit, offset }`.

---

### 6.4 Exact I/O, Database Query & Redis Command Count Matrix

#### Scenario A: Bus Cruising on Highway (Speed >= 5 km/h, Not at Stop)
- **PostgreSQL Queries**: **0** (Stops read from static memory).
- **Redis Commands**: **0** (Zero-Waste Highway Guard skips `GET dwell:active:<busId>` if checked within 10 seconds).
- **WebSocket Frames**: **0**.
- **External Calls**: **0**.

#### Scenario B: Bus Dwelling at Stop / Roadside (Inside 80m, Speed < 5 km/h)
- **PostgreSQL Queries**: **0** (Accumulated entirely in memory and Redis).
- **Redis Commands**: **1** (`SET dwell:active:<busId> ... EX 300`).
- **WebSocket Frames**: **0**.
- **External Calls**: **0**.

#### Scenario C: Bus Departs Stop (Crosses > 100m Boundary)
- **PostgreSQL Queries**: **1**
  - `INSERT INTO public.stop_dwell_logs (trip_id, bus_id, driver_id, route_id, stop_id, stop_name, arrived_at, departed_at, dwell_seconds) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`.
  - Discarded if roadside halt < 15 seconds (0 DB queries).
- **Redis Commands**: **1** (`DEL dwell:active:<busId>`).
- **WebSocket Frames**: **0**.
- **External Calls**: **0**.

#### Scenario D: Admin/Moderator Inspects Trip Dwell Audit Logs (`GET /api/admin/trip-dwell-logs`)
- **PostgreSQL Queries**: **1**
  - `SELECT id, trip_id, bus_id, driver_id, route_id, stop_id, stop_name, arrived_at, departed_at, dwell_seconds, created_at FROM stop_dwell_logs WHERE trip_id = $1 ORDER BY arrived_at ASC LIMIT 50 OFFSET 0` (Hits index `idx_stop_dwell_trip_arrived`).
- **Redis Commands**: **0**.
- **WebSocket Frames**: **0**.
- **External Calls**: **0**.

---

### 6.5 Verbatim Source Code from Live Codebase

#### 6.5.1 `src/domains/gps/services/stop-dwell.service.ts`
```typescript
// Lines 1 - 450 of src/domains/gps/services/stop-dwell.service.ts
import { appLogger } from '@/lib/logger';
import { getSupabaseServer } from '@/lib/supabase-server';
import { getCanonicalStopsForRoute } from '@/domains/route/data/canonical-route-geometries';
import { projectPointToRouteCorridor, isReverseRouteDirection } from '@/domains/route/services/route-alignment-engine';
import { pgFindById } from '@/domains/route/repositories/route.repository.pg';
import { emitEvent } from '@/domains/realtime/event-emitter';
import { invalidateBusTripSnapshot } from '@/lib/services/trip-snapshot-cache';
import {
  getRedisActiveDwell,
  setRedisActiveDwell,
  clearRedisActiveDwell,
  getRedisActiveFlags,
  setRedisActiveFlag,
  updateRedisActiveFlag,
  removeRedisActiveFlag,
  isRedisFlagsHydrated,
  setRedisFlagsHydrated,
} from './gps-redis-guard';

export interface ActiveDwellState {
  busId: string;
  tripId: string;
  driverId: string;
  routeId: string;
  stopId: string;
  stopName: string;
  stopLat: number;
  stopLng: number;
  arrivedAt: string;
  arrivedAtMs: number;
  lastTickMs: number;
  dwellSeconds: number;
  isRoadside?: boolean;
}

export interface StopDwellInput {
  busId: string;
  tripId: string;
  driverId: string;
  routeId?: string;
  lat: number;
  lng: number;
  speed: number | null;
  timestamp: Date;
}

const STOP_ENTER_RADIUS_METERS = 80;
const STOP_EXIT_RADIUS_METERS = 100;
const CORRIDOR_HALT_ENTER_RADIUS_METERS = 80;
const STATIONARY_SPEED_THRESHOLD_KMH = 5.0;
const MIN_ROADSIDE_DWELL_SECONDS = 15;

// In-memory active dwell states by busId (backed by Redis across stateless requests)
const activeDwells = new Map<string, ActiveDwellState>();
const lastDwellRedisCheckMs = new Map<string, number>();
const lastFlagsRedisCheckMs = new Map<string, number>();

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Persist completed dwell record to Supabase stop_dwell_logs asynchronously.
 * Never throws to the caller. Discards roadside halts < 15s.
 */
async function persistDwellRecord(dwell: ActiveDwellState, departedAtIso: string): Promise<void> {
  // Continuous zone residency duration while bus was inside the stop capture zone:
  const residencySeconds = Math.max(0, Math.round((dwell.lastTickMs - dwell.arrivedAtMs) / 1000));
  // Resilient dwell duration against urban multipath GPS speed jitter:
  // If the bus remained inside the stop radius with bounded displacement,
  // compute total dwell duration from Math.max(accumulatedLowSpeedSeconds, residencySeconds)
  // so single-tick speed spikes (>5 km/h) never zero out or truncate the dwell.
  const dwellSeconds = Math.max(Math.round(dwell.dwellSeconds), residencySeconds);

  // Filter out brief roadside traffic taps < 15s
  if (dwell.isRoadside && dwellSeconds < MIN_ROADSIDE_DWELL_SECONDS) {
    return;
  }

  try {
    const supabase = getSupabaseServer();
    const { error } = await supabase.from('stop_dwell_logs').insert({
      trip_id: dwell.tripId,
      bus_id: dwell.busId,
      driver_id: dwell.driverId,
      route_id: dwell.routeId,
      stop_id: dwell.stopId,
      stop_name: dwell.stopName,
      arrived_at: dwell.arrivedAt,
      departed_at: departedAtIso,
      dwell_seconds: dwellSeconds,
    });

    if (error) {
      appLogger.warn('gps', 'stop_dwell_log_insert_failed', {
        busId: dwell.busId,
        stopName: dwell.stopName,
        error: error.message,
      });
    } else {
      appLogger.info('gps', 'stop_dwell_logged', {
        busId: dwell.busId,
        tripId: dwell.tripId,
        stopName: dwell.stopName,
        dwellSeconds,
        isRoadside: dwell.isRoadside ?? false,
        arrivedAt: dwell.arrivedAt,
        departedAt: departedAtIso,
      });
    }
  } catch (err: any) {
    appLogger.warn('gps', 'stop_dwell_persist_error', {
      busId: dwell.busId,
      error: err?.message || err,
    });
  }
}

/**
 * Process a location tick for stop dwell tracking.
 * Called on every accepted GPS update in the pipeline.
 */
export async function trackStopDwell(input: StopDwellInput): Promise<void> {
  try {
    const { busId, tripId, driverId, routeId, lat, lng, speed, timestamp } = input;
    if (!busId || !lat || !lng) return;

    const currentMs = timestamp.getTime();
    let active = activeDwells.get(busId);
    if (!active) {
      const isCruising = speed !== null && speed !== undefined && speed >= STATIONARY_SPEED_THRESHOLD_KMH;
      const lastCheck = lastDwellRedisCheckMs.get(busId) || 0;
      // Zero-Waste Highway Guard: A bus moving >= 5 km/h between stops skips sequential Redis calls
      // if checked within the last 10 seconds.
      if (!isCruising || currentMs - lastCheck >= 10_000) {
        lastDwellRedisCheckMs.set(busId, currentMs);
        active = (await getRedisActiveDwell(busId)) || undefined;
        if (active) {
          activeDwells.set(busId, active);
        }
      }
    }

    if (active) {
      // Check if bus is still dwelling at this stop or roadside halt
      const distToActive = haversineMeters(lat, lng, active.stopLat, active.stopLng);

      if (distToActive <= STOP_ENTER_RADIUS_METERS) {
        // Still inside stop/halt radius
        const deltaSeconds = Math.min(30, Math.max(0, (currentMs - active.lastTickMs) / 1000));
        const isStationary = speed === null || speed === undefined || speed < STATIONARY_SPEED_THRESHOLD_KMH;
        if (isStationary) {
          active.dwellSeconds += deltaSeconds;
        }
        active.lastTickMs = currentMs;
        activeDwells.set(busId, active);
        setRedisActiveDwell(busId, active).catch(() => {});
        return;
      }

      if (distToActive > STOP_EXIT_RADIUS_METERS) {
        // Exited stop radius — conclude dwell
        activeDwells.delete(busId);
        clearRedisActiveDwell(busId).catch(() => {});
        const departedAt = new Date(currentMs).toISOString();
        // Fire-and-forget async write
        persistDwellRecord(active, departedAt).catch(() => {});
      } else {
        // Between 80m and 100m hysteresis buffer — update tick time
        active.lastTickMs = currentMs;
        activeDwells.set(busId, active);
        setRedisActiveDwell(busId, active).catch(() => {});
        return;
      }
    }

    // If no active dwell, search candidate stops on this route
    if (!routeId) return;
    let stops = getCanonicalStopsForRoute(routeId);
    if (!stops || stops.length === 0) {
      const dbRoute = await pgFindById(routeId).catch(() => null);
      if (dbRoute?.stops) {
        stops = dbRoute.stops.map((s, idx) => ({
          name: s.name,
          stop_name: s.stop_name || s.name,
          lat: s.lat,
          lng: s.lng,
          sequence: s.sequence || idx + 1,
        }));
      }
    }

    // 1. Check if bus entered a canonical stop radius (<= 80m)
    let enteredNamedStop = false;
    if (stops && stops.length > 0) {
      for (const stop of stops) {
        const dist = haversineMeters(lat, lng, stop.lat, stop.lng);
        if (dist <= STOP_ENTER_RADIUS_METERS) {
          // Bus entered canonical stop radius — start new dwell tracking
          const newDwell: ActiveDwellState = {
            busId,
            tripId: tripId || 'unknown_trip',
            driverId: driverId || 'unknown_driver',
            routeId,
            stopId: (stop as any).stop_id || `stop_${stop.sequence || 1}`,
            stopName: (stop as any).stop_name || stop.name,
            stopLat: stop.lat,
            stopLng: stop.lng,
            arrivedAt: timestamp.toISOString(),
            arrivedAtMs: currentMs,
            lastTickMs: currentMs,
            dwellSeconds: 0,
            isRoadside: false,
          };
          activeDwells.set(busId, newDwell);
          setRedisActiveDwell(busId, newDwell).catch(() => {});
          enteredNamedStop = true;
          break; // Only anchor to closest stop
        }
      }
    }

    if (enteredNamedStop) return;

    // 2. Check for roadside halt along route corridor between named stops
    // Bus must be stationary (< 5 km/h) and within <= 80m of route polyline
    const isStationary = speed === null || speed === undefined || speed < STATIONARY_SPEED_THRESHOLD_KMH;
    if (isStationary) {
      const corridor = projectPointToRouteCorridor({ lat, lng }, routeId, stops);
      if (corridor.crossTrackDistanceMeters <= CORRIDOR_HALT_ENTER_RADIUS_METERS) {
        const nearestName = corridor.nearestStopName || 'En Route';
        const roadsideDwell: ActiveDwellState = {
          busId,
          tripId: tripId || 'unknown_trip',
          driverId: driverId || 'unknown_driver',
          routeId,
          stopId: `roadside_${Math.round(lat * 10000)}_${Math.round(lng * 10000)}`,
          stopName: `Roadside Halt (near ${nearestName})`,
          stopLat: lat,
          stopLng: lng,
          arrivedAt: timestamp.toISOString(),
          arrivedAtMs: currentMs,
          lastTickMs: currentMs,
          dwellSeconds: 0,
          isRoadside: true,
        };
        activeDwells.set(busId, roadsideDwell);
        setRedisActiveDwell(busId, roadsideDwell).catch(() => {});
      }
    }
  } catch (err: any) {
    // Non-blocking fail-safe: never crash the GPS pipeline
    appLogger.warn('gps', 'stop_dwell_tracking_error', { error: err?.message || err });
  }
}

/**
 * Flush and persist any active dwell state when a trip ends.
 */
export async function flushStopDwellOnTripEnd(busId: string): Promise<void> {
  let active = activeDwells.get(busId);
  if (!active) {
    active = (await getRedisActiveDwell(busId)) || undefined;
  }
  if (!active) return;

  activeDwells.delete(busId);
  clearRedisActiveDwell(busId).catch(() => {});
  const nowIso = new Date().toISOString();
  await persistDwellRecord(active, nowIso);
}

/**
 * Clear in-memory stop dwell state for a bus without persisting.
 */
export function clearStopDwellState(busId: string): void {
  activeDwells.delete(busId);
  lastDwellRedisCheckMs.delete(busId);
  lastFlagsRedisCheckMs.delete(busId);
  clearRedisActiveDwell(busId).catch(() => {});
}

/**
 * Get active dwell state for testing / monitoring.
 */
export function getActiveDwellState(busId: string): ActiveDwellState | undefined {
  return activeDwells.get(busId);
}
```

---

#### 6.5.2 `src/domains/route/data/canonical-route-geometries.ts` (Stop Coordinate Enrichment Helpers)
```typescript
// Lines 313 - 454 of src/domains/route/data/canonical-route-geometries.ts
export function getCanonicalStopsForRoute(routeId: string | null | undefined): CanonicalStop[] {
  if (!routeId) return [];
  const cleanId = routeId.trim().toLowerCase().replace(/-/g, '_');

  if (CANONICAL_ROUTE_STOPS[cleanId]) {
    return CANONICAL_ROUTE_STOPS[cleanId];
  }

  const routeNumMatch = cleanId.match(/route_?(\d+)/);
  if (routeNumMatch) {
    const key = `route_${routeNumMatch[1]}`;
    if (CANONICAL_ROUTE_STOPS[key]) {
      return CANONICAL_ROUTE_STOPS[key];
    }
  }

  if (cleanId.includes('staging_route')) {
    return CANONICAL_ROUTE_STOPS['route_4'];
  }

  return [];
}

export function findCanonicalStopCoordinates(
  routeId: string | null | undefined,
  stopName: string | null | undefined
): LatLng | null {
  if (!stopName) return null;
  const normalizedTarget = stopName.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!normalizedTarget) return null;

  const stops = getCanonicalStopsForRoute(routeId);
  for (const s of stops) {
    const candidate1 = (s.stop_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const candidate2 = (s.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const candidateId = ((s as any).stop_id || (s as any).id || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (
      candidate1 === normalizedTarget ||
      candidate2 === normalizedTarget ||
      (candidateId && candidateId === normalizedTarget) ||
      candidate1.includes(normalizedTarget) ||
      normalizedTarget.includes(candidate1)
    ) {
      return { lat: s.lat, lng: s.lng };
    }
  }

  // Cross-route fallback: check all routes if stopName is unique/known
  for (const stopList of Object.values(CANONICAL_ROUTE_STOPS)) {
    for (const s of stopList) {
      const c = (s.stop_name || s.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const cId = ((s as any).stop_id || (s as any).id || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (
        c === normalizedTarget ||
        (cId && cId === normalizedTarget) ||
        c.includes(normalizedTarget) ||
        normalizedTarget.includes(c)
      ) {
        return { lat: s.lat, lng: s.lng };
      }
    }
  }

  return null;
}

/**
 * Robust stop coordinate enricher.
 * Guarantees that even if database rows in PostgreSQL `routes.stops` contain
 * JSON objects with only `{ name, stopId, sequence }` and missing/zero lat/lng,
 * every stop is enriched with authoritative WGS84 coordinates from the canonical dictionary.
 */
export function enrichRouteStops(
  routeId: string | null | undefined,
  rawStops: any[] | null | undefined
): Array<{ name: string; stop_name: string; sequence: number; lat: number; lng: number; [key: string]: any }> {
  const canonical = getCanonicalStopsForRoute(routeId);

  if (!rawStops || !Array.isArray(rawStops) || rawStops.length === 0) {
    return canonical.map((s, idx) => ({
      ...s,
      name: s.name,
      stop_name: s.stop_name || s.name,
      sequence: s.sequence || idx + 1,
      lat: s.lat,
      lng: s.lng,
    }));
  }

  return rawStops.map((stop: any, idx: number) => {
    const rawName = stop?.name || stop?.stop_name || stop?.stopName || `Stop ${idx + 1}`;
    const stopName = stop?.stop_name || stop?.name || rawName;
    const sequence = typeof stop?.sequence === 'number' ? stop.sequence : idx + 1;
    let lat = typeof stop?.lat === 'number' && Number.isFinite(stop.lat) ? stop.lat : null;
    let lng = typeof stop?.lng === 'number' && Number.isFinite(stop.lng) ? stop.lng : null;

    // If coordinates are missing, non-finite, or identically zero, enrich from canonical
    if (lat === null || lng === null || (lat === 0 && lng === 0)) {
      const stopIdNorm = (stop?.stopId || stop?.stop_id || stop?.id || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
      const nameNorm = rawName.toLowerCase().replace(/[^a-z0-9]/g, '');

      // 1. Match against canonical stops of this route by stopId or name
      let matched = canonical.find((cs) => {
        const csId = (cs.stop_id || cs.id || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (stopIdNorm && csId && (stopIdNorm === csId || csId.includes(stopIdNorm) || stopIdNorm.includes(csId))) {
          return true;
        }
        const csName = (cs.name || cs.stop_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (nameNorm && csName && (nameNorm === csName || csName.includes(nameNorm) || nameNorm.includes(csName))) {
          return true;
        }
        return false;
      });

      // 2. Match by sequence within this route
      if (!matched && canonical.length > 0) {
        matched = canonical.find((cs) => cs.sequence === sequence) || canonical[idx];
      }

      // 3. Cross-route fallback
      if (matched) {
        lat = matched.lat;
        lng = matched.lng;
      } else {
        const crossCoords = findCanonicalStopCoordinates(routeId, rawName) || (stopIdNorm ? findCanonicalStopCoordinates(routeId, stopIdNorm) : null);
        if (crossCoords) {
          lat = crossCoords.lat;
          lng = crossCoords.lng;
        }
      }
    }

    return {
      ...stop,
      name: rawName,
      stop_name: stopName,
      sequence,
      lat: lat ?? 0,
      lng: lng ?? 0,
    };
  });
}
```

---

#### 6.5.3 `src/domains/route/repositories/route.repository.pg.ts`
```typescript
// Lines 61 - 92 of src/domains/route/repositories/route.repository.pg.ts
function pgRowToRoute(row: Record<string, any>): Route {
  const stops = enrichRouteStops(row.id, row.stops);

  return {
    id: row.id,
    routeId: row.id,  // route_id column dropped; routeId domain field reads from id
    routeName: row.route_name,
    stops,
    totalStops: row.total_stops || stops.length,
    estimatedTime: row.estimated_time || '',
    status: row.status === 'inactive' ? 'inactive' : 'active',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function pgFindAll(): Promise<Route[]> {
  const db = getSupabaseServer();
  const { data, error } = await db.from('routes').select('id, route_name, stops, total_stops, estimated_time, status, created_at, updated_at');
  if (error) throw new Error(`RouteRepository (PG) findAll failed: ${error.message}`);
  return (data || []).map(pgRowToRoute);
}

export async function pgFindById(id: string): Promise<Route | null> {
  const db = getSupabaseServer();
  const { data, error } = await db.from('routes').select('id, route_name, stops, total_stops, estimated_time, status, created_at, updated_at').eq('id', id).maybeSingle();
  if (error) throw new Error(`RouteRepository (PG) findById failed: ${error.message}`);
  if (!data) return null;
  return pgRowToRoute(data);
}
```

---

#### 6.5.4 `src/app/api/admin/trip-dwell-logs/route.ts`
```typescript
// Lines 1 - 83 of src/app/api/admin/trip-dwell-logs/route.ts
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

/**
 * GET /api/admin/trip-dwell-logs
 *
 * Incontrovertible Stop Dwell Audit Engine (INV-2)
 * Allows Administrators and Moderators to inspect authoritative dwell logs
 * for student-driver dispute adjudication.
 */
export const GET = withSecurity(
  async (request) => {
    try {
      const supabase = getSupabaseServer();
      const url = new URL(request.url);

      const tripId = url.searchParams.get('tripId') || url.searchParams.get('trip_id');
      const busId = url.searchParams.get('busId') || url.searchParams.get('bus_id');
      const routeId = url.searchParams.get('routeId') || url.searchParams.get('route_id');
      const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)), 200);
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));

      let query = supabase
        .from('stop_dwell_logs')
        .select('id, trip_id, bus_id, driver_id, route_id, stop_id, stop_name, arrived_at, departed_at, dwell_seconds, created_at', {
          count: 'exact',
        });

      if (tripId) {
        query = query.eq('trip_id', tripId);
      }
      if (busId) {
        query = query.eq('bus_id', busId);
      }
      if (routeId) {
        query = query.eq('route_id', routeId);
      }

      // Order chronologically if inspecting a specific trip, otherwise latest first
      if (tripId) {
        query = query.order('arrived_at', { ascending: true });
      } else {
        query = query.order('arrived_at', { ascending: false });
      }

      query = query.range(offset, offset + limit - 1);

      const { data, error, count } = await query;

      if (error) {
        return NextResponse.json(
          { success: false, error: `Failed to fetch stop dwell logs: ${error.message}` },
          { status: 500 }
        );
      }

      const logs = (data || []).map((row: any) => ({
        ...row,
        status: row.dwell_seconds >= 20 ? 'Verified Dwell' : 'Brief Pass-Through',
      }));

      return NextResponse.json({
        success: true,
        logs,
        total: count || 0,
        limit,
        offset,
      });
    } catch (err: any) {
      return NextResponse.json(
        { success: false, error: err?.message || 'Internal server error' },
        { status: 500 }
      );
    }
  },
  {
    requiredRoles: ['admin', 'moderator'],
    rateLimit: RateLimits.READ,
  }
);
```

---

