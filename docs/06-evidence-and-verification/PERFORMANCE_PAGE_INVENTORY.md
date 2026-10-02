# ADTU ITMS — Performance Page Inventory

**Document Reference**: ITMS-PAGE-INVENTORY-2026-09-17  
**Status**: VERIFIED & PRODUCTION HARDENED  
**Framework**: Next.js 16.3.0 (Turbopack, React 19)  

---

## 1. Overview
This inventory catalogs the performance characteristics, rendering models, loading states, and optimizations applied across all major user-facing and administration pages in the ADTU ITMS platform.

---

## 2. Page Inventory Table

| Route | Role(s) | Rendering Model | Baseline Loading UX | Enhanced Loading Architecture | Skeleton / Loading Component | Data Fetching & Polling Optimization | Media / Image Optimization |
|---|---|---|---|---|---|---|---|
| `/` (Landing) | Public, All | **Server Component** | Blocked on client Firebase Auth init (`'use client'`); uncompressed video | Fast Server Component HTML pre-render; thin async `<AuthRedirector />` | Animated hero skeleton | Server-rendered HTML; cached landing video API (1h/24h SWR) | `<video preload="metadata">`, AVIF/WebP image pipeline |
| `/login` | Public | Client Component | Standard form | Instant page shell | Native form skeleton | Static SSG route; zero unnecessary network calls | Zero heavy assets |
| `/student` | Student | Client Component | Indefinite `PremiumPageLoader` unmounting shell; 5s active trip polling loop | Shell visible in ≤3.5s via `usePageShellLoader`; 30s background visibility poll | `MetricCardSkeleton`, `CardLoader` | 5s active trip polling throttled to 30s visibility-aware poll; projected DB queries | Lazy avatar loading |
| `/student/bus` | Student | Client Component | Indefinite `PremiumPageLoader` blocking entire page | Shell visible in ≤3.5s; safe null fallback | `MetricCardSkeleton`, `MapContainerSkeleton` | Parallel `authApiFetch` for bus, route, and stop data; in-memory cached bus/route lookups | N/A |
| `/student/bus-pass` | Student | Client Component | Indefinite `PremiumPageLoader` blocking page | Shell visible in ≤3.5s via `usePageShellLoader` | Digital pass skeleton | One-time Firestore read on mount; v2 128-bit HMAC token verification | Scaled SVG QR rendering |
| `/student/track-bus` | Student | Client Component | Double blocking spinner (`loading` + `dataLoading`); Speed was hardcoded at 0 km/h | Immediate shell with `usePageShellLoader(3500ms)`; Live GPS speed fixed | `MapContainerSkeleton`, Floating Card Skeletons | In-memory GPS read + DB fallback populating speed & heading; 10s visibility poll | Dynamic Leaflet/OSM lazy chunks |
| `/student/profile` | Student | Client Component | Large synchronous Cloudinary image load | Immediate profile shell | Profile card skeleton | Direct Firestore read with field sanitization | `<img loading="lazy" decoding="async">` |
| `/driver` | Driver | Client Component | Indefinite `PremiumPageLoader` blocking dashboard | Shell visible in ≤3.5s via `usePageShellLoader` | `MetricCardSkeleton`, Trip Card Skeletons | Cached dashboard API; conditional lock inspection; projected DB fields | Lazy loaded driver badge |
| `/driver/live-tracking` | Driver | Client Component | Full-screen blocking loader unmounting HUD | Shell visible in ≤3.5s; immediate HUD render | Leaflet container skeleton, GPS status HUD | Throttled 15s conditional lock poll; native wake-lock API; in-memory trip lock cache | N/A |
| `/driver/students` | Driver | Client Component | Indefinite loader; `quality={100}` on student avatars | Shell visible in ≤3.5s; `quality={80}` on avatars | `CardLoader` student list skeleton | Single fetch on mount; WebSocket waiting flag events; projected flag columns | `Next/Image quality={80}` |
| `/admin` | Admin | Client Component | Full-page blocker unmounting admin sidebar & navigation | Shell visible in ≤3.5s via `usePageShellLoader` | 4x `MetricCardSkeleton`, Chart Skeletons | Stale-while-revalidate counts; event-driven cache invalidation | Inline SVG icons |
| `/admin/students` | Admin | Client Component | Blocking spinner; empty table flash ("No students found") | Immediate shell; Table skeleton replaces empty flash | `TableLoader` (6 rows, 7 columns) | Projected columns (`PG_STUDENT_COLUMNS`); eliminates full row table scans | Cloudinary avatar url sanitization |
| `/admin/buses` | Admin | Client Component | Blocking spinner; empty table flash | Immediate shell; Table skeleton replaces empty flash | `TableLoader` (5 rows, 7 columns) | Bounded in-memory TTL fleet caching (2 min); projected columns | Inline SVG icons |
| `/admin/drivers` | Admin | Client Component | Blocking spinner; empty table flash | Immediate shell; Table skeleton replaces empty flash | `TableLoader` (5 rows, 6 columns) | Projected driver profile columns (`DRIVER_COLUMNS`); dynamic assignment resolution | Inline SVG icons |
| `/admin/routes` | Admin | Client Component | Blocking spinner; empty table flash | Immediate shell; Table skeleton replaces empty flash | `TableLoader` (6 rows, 6 columns) | Bounded in-memory TTL route caching (5 min); projected columns | Inline SVG icons |
| `/admin/applications` | Admin | Client Component | Indefinite `PremiumPageLoader` when applications = 0 | Shell visible in ≤3.5s; Card skeletons for pending items | `CardLoader` (4 cards) | Unified application API with manual refresh; projected columns (`APPLICATION_COLUMNS`) | Optimized Cloudinary avatars |
| `/moderator` | Moderator | Client Component | Full-page blocker unmounting moderator navigation | Shell visible in ≤3.5s via `usePageShellLoader` | 4x `MetricCardSkeleton`, Skeletons | Single fetch on mount; event-driven refresh; projected columns | Inline SVG icons |
| `/moderator/dashboard` | Moderator | Client Component | Indefinite blocking spinner | Shell visible in ≤3.5s; card skeletons | `MetricCardSkeleton`, `CardLoader` | Projected `active_trips` columns; zero persistent WebSocket leak | Inline SVG icons |
| `/moderator/applications` | Moderator | Client Component | Full-screen blocking loader on empty list | Shell visible in ≤3.5s; Card skeletons | `CardLoader` list skeleton | Projected application columns; event-driven refresh | Optimized Cloudinary avatars |

---

## 3. Architectural Invariants Maintained
1. **Zero Weakening of Security**: All permission guards, role validations, CSRF tokens, and ID token checks remain strictly enforced across all 224 compiled routes.
2. **Deterministic Fallback**: The 3.5s timeout on `PremiumPageLoader` acts strictly as a UX bound; background data fetches proceed uninterrupted.
3. **No Faked Performance**: Skeletons only replace loaders to provide visual structural stability; real data smoothly replaces skeletons once resolved.
4. **Authoritative GPS Integrity**: Student and driver tracking pages render GPS markers with client-side interpolation, but all raw coordinates stored in PostgreSQL/Redis remain authoritative and unmanipulated.
