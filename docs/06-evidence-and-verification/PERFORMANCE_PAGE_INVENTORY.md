# ADTU ITMS — Performance Page Inventory

## Overview
This inventory catalogs the performance characteristics, loading states, and optimizations applied across all major user-facing and administration pages in the ADTU ITMS platform.

---

## Page Inventory Table

| Route | Role(s) | Baseline Loading UX | Enhanced Loading Architecture | Skeleton / Loading Component | Data Fetching & Polling Optimization | Media / Image Optimization |
|---|---|---|---|---|---|---|
| `/` (Landing) | Public, All | Unbounded video buffer, heavy hero media | Immediate hero render, metadata-first video buffering | Animated hero skeleton | Supabase landing video API cached | `<video preload="metadata">` |
| `/login` | Public | Standard form | Instant page shell | Native form skeleton | Static SSG route | Zero heavy assets |
| `/student` | Student | Indefinite `PremiumPageLoader` unmounting shell; 5s active trip polling loop | Shell visible in ≤3.5s via `usePageShellLoader`; 30s background visibility poll | `MetricCardSkeleton`, `CardLoader` | 5s active trip polling throttled to 30s visibility-aware poll | Lazy avatar loading |
| `/student/bus` | Student | Indefinite `PremiumPageLoader` blocking entire page | Shell visible in ≤3.5s; safe null fallback | `MetricCardSkeleton`, `MapContainerSkeleton` | Parallel `authApiFetch` for bus, route, and stop data | N/A |
| `/student/bus-pass` | Student | Indefinite `PremiumPageLoader` blocking page | Shell visible in ≤3.5s via `usePageShellLoader` | Digital pass skeleton | One-time Firestore read on mount | Scaled SVG QR rendering |
| `/student/track-bus` | Student | Double blocking spinner (`loading` + `dataLoading`); Speed was hardcoded/broken at 0 km/h | Immediate shell with `usePageShellLoader(3500ms)`; Live GPS speed fixed | `MapContainerSkeleton`, Floating Card Skeletons | In-memory GPS read + DB fallback populating speed & heading; 10s visibility poll | Dynamic Leaflet/OSM lazy chunks |
| `/student/profile` | Student | Large synchronous Cloudinary image load | Immediate profile shell | Profile card skeleton | Direct Firestore read with field sanitization | `<img loading="lazy" decoding="async">` |
| `/driver` | Driver | Indefinite `PremiumPageLoader` blocking dashboard | Shell visible in ≤3.5s via `usePageShellLoader` | `MetricCardSkeleton`, Trip Card Skeletons | Cached dashboard API; conditional lock inspection | Lazy loaded driver badge |
| `/driver/live-tracking` | Driver | Full-screen blocking loader unmounting HUD | Shell visible in ≤3.5s; immediate HUD render | Leaflet container skeleton, GPS status HUD | Throttled 15s conditional lock poll; native wake-lock API | N/A |
| `/driver/students` | Driver | Indefinite loader; `quality={100}` on student avatars | Shell visible in ≤3.5s; `quality={80}` on avatars | `CardLoader` student list skeleton | Single fetch on mount; WebSocket waiting flag events | `Next/Image quality={80}` |
| `/admin` | Admin | Full-page blocker unmounting admin sidebar & navigation | Shell visible in ≤3.5s via `usePageShellLoader` | 4x `MetricCardSkeleton`, Chart Skeletons | Stale-while-revalidate counts; event-driven cache invalidation | Inline SVG icons |
| `/admin/students` | Admin | Blocking spinner; empty table flash ("No students found") | Immediate shell; Table skeleton replaces empty flash | `TableLoader` (6 rows, 7 columns) | PostgreSQL API collection with memoized bus lookup | Cloudinary avatar url sanitization |
| `/admin/buses` | Admin | Blocking spinner; empty table flash | Immediate shell; Table skeleton replaces empty flash | `TableLoader` (5 rows, 7 columns) | Memoized route indexing; event-driven refresh | Inline SVG icons |
| `/admin/drivers` | Admin | Blocking spinner; empty table flash | Immediate shell; Table skeleton replaces empty flash | `TableLoader` (5 rows, 6 columns) | Driver-to-bus dynamic assignment resolution | Inline SVG icons |
| `/admin/routes` | Admin | Blocking spinner; empty table flash | Immediate shell; Table skeleton replaces empty flash | `TableLoader` (6 rows, 6 columns) | O(1) Map-indexed bus-to-route lookup | Inline SVG icons |
| `/admin/applications` | Admin | Indefinite `PremiumPageLoader` when applications = 0 | Shell visible in ≤3.5s; Card skeletons for pending items | `CardLoader` (4 cards) | Unified application API with manual refresh; memoized capacity status | Optimized Cloudinary avatars |
| `/moderator` | Moderator | Full-page blocker unmounting moderator navigation | Shell visible in ≤3.5s via `usePageShellLoader` | 4x `MetricCardSkeleton`, Skeletons | Single fetch on mount; event-driven refresh | Inline SVG icons |
| `/moderator/dashboard` | Moderator | Indefinite blocking spinner | Shell visible in ≤3.5s; card skeletons | `MetricCardSkeleton`, `CardLoader` | One-time active trip query; zero persistent channels | Inline SVG icons |
| `/moderator/applications` | Moderator | Full-screen blocking loader on empty list | Shell visible in ≤3.5s; Card skeletons | `CardLoader` list skeleton | Event-driven refresh; manual refresh trigger | Optimized Cloudinary avatars |

---

## Architectural Invariants Maintained
1. **Zero Weakening of Security**: All permission guards, role validations, CSRF tokens, and ID token checks remain strictly enforced.
2. **Deterministic Fallback**: The 3.5s timeout on `PremiumPageLoader` acts strictly as a UX bound; background data fetches proceed uninterrupted.
3. **No Faked Performance**: Skeletons only replace loaders to provide visual structural stability; real data smoothly replaces skeletons once resolved.
