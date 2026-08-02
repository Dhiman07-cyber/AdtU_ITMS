# 09 — Frontend & WS Client Audit

## Business Understanding
Next.js app (student app, driver app, admin/moderator console). The realtime layer (`src/domains/realtime/`) connects to the WS nodes for live bus locations, trip events, presence. PWA with service worker; Cloudinary for photo uploads; Firebase Auth + FCM tokens.

## Architecture
- `ws-client.ts` — connection manager: auth (first-message token), `reconnect_token` persistence, exponential backoff, ping/pong watchdog.
- `transport/websocket.ts` — low-level wrapper.
- Page-level hooks subscribe to channels (`trip:{busId}`, `presence`, `notifications`).

## Agent-reported findings (medium–high confidence; not all re-read this session)

| # | Finding | Evidence | Confidence |
|---|---------|----------|------------|
| F1 | WS URL query carries `idToken` and `reconnect_token` — leaks into access/proxy logs (Path A is deprecated server-side but client still connects this way) | ws-client.ts connection URL | High (matches server Path A warn log) |
| F2 | `reconnect_token` stored in localStorage + URL — XSS-adjacent persistence of a session-restore credential | ws-client.ts | High |
| F3 | Exponential backoff caps at 30s, max 10 attempts → permanent error state with no manual retry UI | ws-client.ts | Medium |
| F4 | `pendingSubscriptions` re-sent on every reconnect; duplicate subscription risk — server `activeSubscriptions` Set guard may dedupe, but resubscribe storm on reconnect | ws-client.ts | Medium |
| F5 | PWA/service worker cache invalidation: new releases may serve stale bundles (no `workbox` version bump or `skipWaiting` handling) | public/sw.js | Medium |
| F6 | Page hooks: `useEffect` subscriptions not always cleaned up (double-subscribe after Fast Refresh / unmount) | page hooks | Medium |
| F7 | Token refresh while socket open: `auth_required`/401 handling reconnects but does not refresh Firebase token first → reconnect loop when token expired mid-session | ws-client.ts | Medium |

## What is solid (agent-verified)
- Ping/pong 3-cycle watchdog kills dead sockets and reconnects.
- Backoff is bounded (30s cap, 10 attempts) — prevents reconnect storms.
- Reconnect restores session via `reconnect_token` (server validates ownership: only restores when token belongs to the authenticated user — verified at websocket-server.ts:144-145).

## Recommendations
1. F1/F2: move `reconnect_token` out of URL; send via first-message `auth` payload (server Path A removal in report 01 pairs with this).
2. F7: on reconnect, refresh Firebase token first, then connect.
3. F5: add cache-busting/version bump on SW update; `skipWaiting` + clientsClaim or explicit update flow.
4. F6: audit hook cleanup; use the subscription-manager pattern (returns unsubscribe).
5. F3: surface permanent-disconnect state with a manual "Reconnect" action.

## Confidence
Medium–High: patterns confirmed during the frontend agent's walkthrough; F1/F2 corroborated by server-side Path A warning logs.
