# 10 — WS Server & Redis Deep Audit

## Business Understanding
The custom WS server (`server/`, Node + `ws` 8.21.1) is the realtime backbone: authenticated push, GPS pipeline, trip events, presence, offline queue. Redis (optional) is used for cross-node broadcast and location keys. This report covers process-level robustness, the wire protocol, and the Redis client.

## Verified Findings

### C1 — Pre-auth socket crash kills the process [VERIFIED]
- **Where:** `server/websocket-server.ts:32,205`; `server/index.ts:120-121`
- **Issue:** `ws.on('error', ...)` is attached at line 205 — **after** authentication completes. During the pre-auth window (up to 5s Path-B timeout, plus Firebase verify latency) any socket-level error — `maxPayload` violation (64KB, `:30`), invalid UTF-8 in a frame, connection reset mid-frame — emits `'error'` on the WebSocket object with **zero listeners**. `ws` does not swallow receiver errors; Node throws an uncaught exception → process exits. No `uncaughtException`/`unhandledRejection` handler exists in `server/index.ts`.
- **Impact:** One malformed socket (scripted client, slow-loris variant, bad proxy) can crash a WS node. In docker-compose with restart policies the node comes back, but all active sessions drop, offline-queue state in memory is lost, and the node is unavailable for the restart window. With ws1/ws2, half the fleet dies at once if both are hit.
- **Fix (smallest):** attach `ws.on('error', ...)` at connection start (line ~33), before auth; log and close. Additionally add `process.on('uncaughtException')`/`unhandledRejection` handlers in `server/index.ts` that log and exit (fail-fast) or continue, as ops prefers.

### H6 — Rate limiter: one shared IP bucket behind nginx [VERIFIED]
- `websocket-server.ts:39` `request.socket.remoteAddress` (nginx's address for all clients) → `checkRateLimit` → single `ipBuckets` entry. Full analysis in report 03. Per-user (200) and per-socket (60) budgets are fine; the IP budget (~100/10s) becomes a global cap.

### H7 — Redis RESP parser breaks on embedded newlines [VERIFIED]
- **Where:** `server/redis-client.ts` (hand-rolled RESP client)
- **Issue:** Response parsing splits frames line-based. Redis **bulk strings** are length-prefixed (`$<len>\r\n<data>\r\n`); data may legitimately contain `\r\n` (JSON payloads, especially message payloads). A line-based splitter will fragment a bulk payload containing `\r\n`, corrupting channel/message indices and JSON parse.
- **Impact:** Live-location broadcasts over Redis (cross-node) with payloads containing `\r\n` corrupt the stream; subscription notifications misroute. Intermittent and silent.
- **Fix:** parse RESP by declared lengths (read `$n` then `n` bytes), not by lines.

## Agent-reported findings (medium confidence)

| # | Finding | Evidence | Confidence |
|---|---------|----------|------------|
| WS-1 | `publish` is fire-and-forget: `socket.write` errors on broadcast are unhandled (no retry/backpressure) | redis-broadcast.ts | High (pattern) |
| WS-2 | `tokenAuthCache` eviction removes only expired entries — with all-valid tokens the cache grows unboundedly | authenticator.ts (threshold 1000+) | High |
| WS-3 | Pre-auth buffer bounded (32) — flood closes socket (good); but the timeout path in Path B never removes the temp `message` listener (minor leak until socket close) | websocket-server.ts:88-115 | High |
| WS-4 | Session restore is delete-old + create-new (brief gap where client is subscribed to nothing) | session-manager.ts | Medium |
| WS-5 | `sendToSocket` no-op after close; queued broadcasts during shutdown may be lost silently | socket-router.ts | Medium |
| WS-6 | Heartbeat: server pings with its own interval; client heartbeat (60s) vs `last_heartbeat` staleness in `extend_trip_lock` — mismatch can end trips during light use | heartbeat-service.ts + migration | Medium |

## What is solid (verified)
- Message pipeline is single-parse: size check → JSON → schema (`validateMessage`) → rate limit → replay check → route. Replay guard exists.
- Pre-auth buffering + replay prevents subscribe-loss races; bounded buffer (32).
- Reconnect-token restore validates ownership (uid match).
- Graceful shutdown (SIGTERM/SIGINT), health endpoint, structured audit logs on connect/disconnect.

## Recommendations
1. C1: attach error listener pre-auth + process-level handlers (highest priority in this report).
2. H6: proxied client IP or drop IP bucket in WS path.
3. H7: length-based RESP parser.
4. WS-2: bound the auth cache (LRU or size cap with eviction).
5. WS-1: handle publish failures (log + retry with backoff, or at least count them).

## Confidence
High for VERIFIED rows; High–Medium for agent rows (mechanisms read; runtime behavior not reproduced).
