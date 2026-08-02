# 13 — Long-Running Session Behaviour

**Audit class:** what happens to realtime sessions over hours — network flips, background kills, GPS gaps, reconnects, restarts.
**Method:** 11 user-defined scenarios traced through client (`ws-client.ts`) + server (session/heartbeat/cleanup/offline-queue/redis) code. FAIL/RISK rows re-verified after the agent pass.

## Verdict summary

| # | Scenario | Verdict |
|---|----------|---------|
| 1 | Three-hour trip (idle-but-healthy socket) | PASS (see D2) |
| 2 | Redis down 20 minutes | **RISK** |
| 3 | Wi-Fi ↔ LTE flip | **FAIL** |
| 4 | Driver force-closes app mid-trip | **RISK** |
| 5 | Android kills background process, 15-min return | PASS (caveats) |
| 6 | GPS freezes 90 seconds | **FAIL** (no staleness anywhere) |
| 7 | Student offline 15 min while trip ends | **FAIL** (offline queue is dead code) |
| 8 | Server restart with 2000 sockets | **RISK** |
| 9 | Idle-session memory | PASS (one leak) |
| 10 | Timer accumulation | PASS |
| 11 | Half-open socket (no close event) | PASS |

## Verified FAIL rows

### L-1 · Reconnect restores the session with ZERO subscriptions [VERIFIED — biggest realtime bug in the system]
- **Trace:** `websocket-server.ts:146-147` calls `subscriptionManager.unsubscribeAll(oldSocketId, oldSession)` BEFORE `sessionManager.restoreSession(...)`. `unsubscribeAll` (`subscription-manager.ts:25-30`) **clears the session's `subscriptions` Set** and removes its socketId from `channelSubscriptions`. `restoreSession` (`session-manager.ts:148-167`) then captures that (now empty) set and restores nothing; the reverse index is never repopulated for the new socketId.
- Client never compensates: `ws-client.ts:136` re-sends only `pendingSubscriptions`, which every `subscribed` ack empties (`:149`).
- **Result:** after EVERY successful reconnect/restore (network flip, failover, deploy), the client is connected-but-deaf — no `trip:{bus}` events, no waiting-flag pushes, frozen map — until page reload. This is exactly the Wi-Fi↔LTE scenario, every time.
- **Fix:** in the restore path, copy the channel list BEFORE `unsubscribeAll` and re-add the new socketId to `channelSubscriptions`; and/or client re-sends all `handlers` keys on `auth_ok`.

### L-2 · GPS-freeze / stale-location display (S6)
- No staleness check anywhere: server `liveBusLocations` has no expiry and is never cleared (`socket-router.ts:54-66` — `clearLiveBusLocation` zero callers); new subscribers get the cached (possibly hours-old) fix (`:76-83`); `trip-status` serves cache or DB row with no age check; client `useBusLocation`/track-bus apply any payload. The location-display guards (`isNewerTimestamp`/`isImpossibleJump`) exist but are **unused** (`lib/maps/location-display-guards.ts:35-54`).
- **Result:** a 90s GPS gap → map shows a static marker with no "stale" indication for up to 10 min (or 24h via L-3).
- **Fix:** timestamp the cached location; client renders "N s ago" and clears marker when `now − ts > 60s` (guards already written).

### L-3 · Offline queue is dead code (S7)
- Queue keyed by server-generated socketId (`offline-queue.ts:37-44`) that no second connection ever reuses; `connection-cleanup-service.ts:15` clears it on close before any drain; half-open sockets get sends-into-the-void instead of queuing (`websocket-server.ts:286-288`); `drainQueue` runs against a new socketId whose queue is always empty.
- **Result:** `trip_ended` and waiting-flag events for a student offline 15 min are **never delivered**; UI only corrects via HTTP refetch on focus.
- **Fix:** key the queue by uid, drain on any new session for that uid (TTL 5 min already exists), or client refetches trip-status on `auth_ok`.

### L-4 · `trip-status` ignores lock expiry [VERIFIED]
- `api/student/trip-status/route.ts:48-56` selects `trip_id..last_heartbeat` but NOT `expires_at` and filters nothing — a trip whose lock expired (driver dead; stale-cron runs daily 04:00) still returns `tripActive: true` for up to ~24h. Students wait at a stop for a bus that left the system.
- **Fix:** filter `.gt('expires_at', new Date().toISOString())`.

## Verified RISK rows

### L-5 · Redis down / startup-deaf node (S2)
- Reconnect works for a clean outage (5s fixed timer, generation-guarded, resubscribe on sub-connect — `redis-client.ts:167-173,100-111`) and the server never crashes. But: publishes during the outage are silently dropped (no buffer, no replay — Redis has none); if Redis is down **at startup**, the relay never subscribes and the node stays permanently deaf cross-node (`index.ts:34-47`); no TCP keepalive on the raw socket → a silent partition never triggers reconnect (`redis-client.ts:44-91`); `/health/ready` reports `redis: 'ok'` whenever `REDIS_URL` is set, no connectivity check (`health-service.ts:49-51`).
- **Fix:** bounded publish buffer drained on reconnect; keepalive; relay subscription retry; readiness probes actual connectivity; reconnect jitter.

### L-6 · Driver force-close mid-trip (S4)
- No trip release on socket close (`websocket-server.ts:199-203` cleanup is session-only); lock TTL 600s refreshed by the driver page over HTTP every 60s (`trip-lock-service.ts:155-162,203`); stale-lock cron daily 04:00 (route comment "every minute" is a lie — `vercel.json:21` is `0 4 * * *`). Bus is usable ≤10 min after driver death (TTL semantics — good), but nothing broadcasts `trip_ended` until 04:00, and L-4 shows the trip as active to students the whole time.
- **Fix:** L-4 filter + per-minute (or event-driven) trip_ended broadcast on lock expiry.

### L-7 · Restart flood (S8)
- Graceful drain is well-built (`index.ts:94-121`, 30s failsafe) — but compose's 10s stop timeout SIGKILLs mid-drain (report 15). On recovery, 2000 clients reconnecting instantly blow the shared-per-IP WS rate bucket (~100 msgs/10s behind nginx — H6) → mass subscribe messages dropped → combined with L-1, widespread connected-but-deaf.
- **Fix:** H6 + L-1 together; or exempt first-5s messages from the IP bucket.

## PASS rows (evidence of sound design)
- **3h idle:** all timers activity-renewed; no absolute session timeout; single global heartbeat scan loop, no per-socket timers.
- **Half-open:** server ping 30s → missed≥2 → close(4002) ~65-95s; client watchdog 75s → close+reconnect. Both directions covered.
- **Timer census:** only per-connection timer is the 5s auth timeout, cleared on auth (`websocket-server.ts:89-100`). No interval renews another.
- **Memory:** all maps keyed by socketId cleaned on close; rate buckets/nonces/queues TTL-swept. **One leak:** `heartbeatService.missedCount` entries for closed sockets never deleted (`heartbeat-service.ts:39-51`) — KB/month, cosmetic.

## Other defects (D-series)
- **D1** `ws-client.ts:136` — resubscribe only pending (feeds L-1). Fix: resend all `handlers` keys on `auth_ok`.
- **D2** After ~1h, Firebase token expiry → server 4001 → client without `getNewToken` enters permanent `error` ("Reconnect stopped", `ws-client.ts:168-174`). Track-bus (`track-bus/page.tsx:370`), driver (`live-tracking/page.tsx:473`), `useBusLocation.ts:117` all create clients WITHOUT `getNewToken` → any network blip after hour 1 = dead UI until reload. **Fix: pass `getNewToken` to all clients.** (This is the "3-hour trip" killer.)
- **D3** `restoreSession` keeps the old IP on the new session (`session-manager.ts:162` — logging only, cosmetic).
- **D4** Visibility-change double reconnect (one spurious cycle per background return, `ws-client.ts:76-88` vs `165-177`).
- **D5** `drainQueue` ignores TTL (delivers expired messages if a reconnect lands in the 60s sweep window).

## Confidence
HIGH — L-1..L-4 re-verified against source this session; agent-traced rows marked.
