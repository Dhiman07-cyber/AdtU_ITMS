# ADTU ITMS — Performance Findings Ledger

## Executive Summary
During real-world device testing and deep codebase profiling of ADTU ITMS, two critical defects and three architectural bottlenecks were identified:
1. **Student Bus Tracking Speed Defect**: The live speed was permanently displayed as "0 km/h" or "0.0 km/h".
2. **Unbounded Full-Page Spinner Lockup**: The UI remained blocked behind a full-screen loading spinner indefinitely until all network requests resolved, hiding the entire page shell, sidebar, and controls.
3. **Aggressive Client-Side Polling Loops**: Intervals such as `setInterval(..., 5000)` ran in the background regardless of page visibility or active WebSocket connections, causing CPU and network churn.
4. **Table Flash / Blank Content**: Tables initially flashed empty states ("No students found", "No buses found") before data resolved, causing Cumulative Layout Shift (CLS).
5. **Media Congestion on Mobile Networks**: High-resolution video assets without metadata bounds and avatar images with unoptimized quality slowed down Time to Interactive (TTI).

---

## Finding Details & Root Cause Analysis

### Finding 1: Student Live Tracking Speed Stuck at "0 km/h"
- **Severity**: HIGH (Core Product Defect)
- **Symptom**: During active bus journeys, students viewing the tracking map observed the speed indicator constantly reading "0 km/h" even while the bus was in motion.
- **Root Cause**:
  1. Driver devices transmit GPS telemetry with velocity in meters per second (`coords.speed`).
  2. The server-side API `/api/student/trip-status/route.ts` omitted `speed` in both its in-memory retrieval (`getLastLocationForBus`) and its PostgreSQL fallback query (`.select('lat, lng, timestamp')`).
  3. In `src/components/maps/LiveTrackingBusMap.tsx`, `LiveTrackingBusMapProps` did not include a `speed` prop.
  4. In `src/app/student/track-bus/page.tsx`, the `speed` prop was never passed to `<LiveTrackingBusMap />`.
  5. In `src/components/maps/GuwahatiBusMap.tsx`, the component read only `props.speed` (which was undefined), completely ignoring `busLocation.speed`.
  6. In `src/components/DynamicStudentMap.tsx`, raw GPS m/s was formatted with string concatenation without the `* 3.6` conversion factor required to convert m/s to km/h.
- **Resolution**:
  - Populated `speed`, `heading`, and `accuracy` in `inMemoryLastLocations` and the DB query in `/api/student/trip-status`.
  - Added `speed?: number` to `LiveTrackingBusMapProps` and passed `busLocation?.speed` from `track-bus/page.tsx`.
  - Updated `GuwahatiBusMap.tsx` to read `speed || busLocation?.speed` and convert GPS m/s to km/h (`* 3.6`) with a stationary floor at 0.
  - Formatted speed in `DynamicStudentMap.tsx` using proper km/h calculation.
- **Verification**: Tests passed; type checks clean; speed calculations verified in unit tests.

---

### Finding 2: Unbounded Full-Page Spinner Lockup
- **Severity**: HIGH (Perceived Performance / UX)
- **Symptom**: On slow 3G/4G connections or under server latency, users were stuck staring at a full-page loading spinner for 10–20+ seconds, unable to view the page layout, navigation, or breadcrumbs.
- **Root Cause**:
  - Components implemented early returns:
    ```tsx
    if (loading) {
      return <PremiumPageLoader message="..." />;
    }
    ```
  - This unmounted the entire layout shell (sidebar, navigation, headers). If any individual query was slow, the user was completely blocked from interacting with the application.
  - `src/app/loading.tsx` lacked any timeout fallback mechanism.
- **Resolution**:
  - Built `usePageShellLoader(loading, maxDurationMs = 3500)` hook that sets a hard ceiling of 3.5s on full-screen spinners.
  - Enhanced `PremiumPageLoader` in `src/app/loading.tsx` with `maxDurationMs`, `onTimeout`, and fallback support.
  - Implemented modular skeletons (`MetricCardSkeleton`, `TableLoader`, `MapContainerSkeleton`, `CardLoader`) across Admin, Moderator, Driver, and Student portals.
  - Replaced blocking returns with progressive skeleton rendering.
- **Verification**: Build generated all 221 pages cleanly; timeout triggers fail-safely in all simulated delayed network conditions.

---

### Finding 3: Excessive Background Polling Churn
- **Severity**: MEDIUM (Battery / CPU / DB Load)
- **Symptom**: Lightweight mobile devices became laggy during prolonged use.
- **Root Cause**:
  - `src/app/student/page.tsx` executed `setInterval(checkActiveTrip, 5000)` indefinitely, regardless of whether the student had an active trip or whether the browser tab was in the background.
  - This resulted in 12 unnecessary API calls per minute per active tab.
- **Resolution**:
  - Throttled the background poll from 5 seconds to 30 seconds.
  - Added `document.visibilityState === 'visible'` check so background tabs do not fire polling requests.
- **Verification**: Polling reduced by 83.3% while maintaining real-time event updates via WebSockets.

---

### Finding 4: Table Flash and Cumulative Layout Shift
- **Severity**: MEDIUM (Visual Stability)
- **Symptom**: Visiting Admin/Moderator management pages showed an empty table ("No students found", "No buses found", "No routes found") for 500–1500ms before suddenly jumping to populate the real rows.
- **Root Cause**:
  - Tables checked `filteredData.length === 0` and rendered the empty state immediately, without checking if `isLoading` was still true.
- **Resolution**:
  - Replaced early empty state renders with `TableLoader` skeletons matching the exact row and column dimensions of the target table.
- **Verification**: Zero CLS during initial data fetch; smooth skeleton-to-content transition.

---

### Finding 5: Media & Asset Congestion
- **Severity**: LOW-MEDIUM (Network Bandwidth)
- **Symptom**: Initial landing page and student directory pages consumed excessive cellular data and experienced main-thread decoding jank.
- **Root Cause**:
  - Landing video tag lacked `preload="metadata"`, triggering greedy byte-range prefetching.
  - Student directory avatars in `driver/students/page.tsx` used `quality={100}` on small thumbnails.
  - Profile image in `student/profile/page.tsx` lacked `loading="lazy"` and `decoding="async"`.
- **Resolution**:
  - Added `preload="metadata"` to landing video.
  - Set `quality={80}` on avatar thumbnails.
  - Added `loading="lazy"` and `decoding="async"` to profile images.
- **Verification**: Build verified; network payload reduced on initial visit.
