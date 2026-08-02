# 14 — Performance Under Scale

**Audit class:** hot paths with thousands of concurrent users — O(n²), N+1, duplicate reads, leaks, blocking ops, broadcast amplification.
**Method:** hot-path tracing (GPS pipeline, WS per-message, student polling, dashboard loads) + systematic scan for each failure class. Findings verified against source; per-invocation cost estimates below.

## The dominant hot path: 1Hz–2s GPS fan-out
`POST /api/location/update` (driver GPS, every ~2s) → `withSecurity` (RSA verify + rate limit) → `processUpdate` → **awaited `active_trips` UPDATE** → `emitEvent` → WS bridge (1 socket) → server `broadcast` handler → 2× `broadcastToChannel` (encode + N socket writes) → Redis PUBLISH. **This single flow dominates the whole system's load.**

## Findings (ranked)

### P-1 HIGH · Awaited DB write on every GPS tick [VERIFIED]
- `src/app/api/location/update/route.ts:52-65` — `await supabase.from('active_trips').update({last_heartbeat})` on **every** push, no throttle (the comment explains why: serverless `.then()` isn't guaranteed — a legitimate concern, but the fix is a 20s in-memory throttle like `heartbeatWriteCache`, which already exists for breadcrumbs). 200 buses × ~2s = ~100 awaited PostgREST writes/s, each adding ~10-20ms to driver p99.
- Redundant: `/api/driver/heartbeat` already extends the lock throttled to 20s (`trip-lock-service.ts:203`, `HEARTBEAT_MIN_WRITE_INTERVAL_MS`), and the stale cron tolerates 600s.
- **Fix:** reuse the 20s write-throttle (write at most every 20s per bus). ~20× reduction.

### P-2 HIGH · Unpaginated full-table student list [VERIFIED]
- `src/app/api/students/route.ts:84` → `getStudentsByStatus('active')` → `.select('*')` of every active student (limit/offset only apply on the `q` path; the default and `busId` paths ignore them). With thousands of students: full PII dump per admin/driver request + JS-side filter (`:47`).
- **Fix:** `.range(offset, limit)` + column projection on default/busId paths; push the status filter into SQL.

### P-3 HIGH · O(n) `clearRateLimitsFor` per disconnect [VERIFIED]
- `src/lib/security/rate-limiter.ts:34-38` iterates ALL `socketBuckets` to delete one entry — O(sockets) per disconnect, O(n²) under reconnect churn at 10k sockets. Key IS the socketId.
- **Fix:** `socketBuckets.delete(socketId)` — one line.

### P-4 HIGH · Redis pub/sub parser re-splits the whole buffer per chunk
- `server/redis-client.ts:144-165` — `buffer.split('\r\n')` on every `data` event → O(n²) in buffered bytes under relay backlog; no yield → one tick blocks for large batches. (Same parser family as H7.)
- **Fix:** incremental line scanning from last offset.

### P-5 HIGH · Unbounded `missedCount` leak [VERIFIED]
- `server/heartbeat-service.ts:39-51` — entries deleted only when the socket is alive and heartbeating; timed-out/closed sockets leave entries forever (the sweep never visits them again). Unbounded slow growth; O(sockets) churn.
- **Fix:** delete in the timeout branch + on socket `close` (websocket-server.ts:199).

### P-6 MED · Broadcast waste per GPS tick [VERIFIED]
- `server/socket-router.ts:168-175` — (a) broadcasts to legacy `bus:${busId}` channel nobody subscribes to anymore; (b) `encodeMsg` runs even with 0 subscribers (`websocket-server.ts:279` before the length check); (c) one Redis PUBLISH per tick regardless of audience — with 2000 buses that's 2000 publishes/s even at 1 subscriber per bus.
- `BROADCAST_BATCH_SIZE=100` slicing (`websocket-server.ts:282-293,319-330`) is synchronous — batching yields nothing, just allocates arrays.
- **Fix:** short-circuit on empty subscribers; delete the dead `bus:` channel; gate the Redis publish on having any subscriber.

### P-7 MED · Duplicate reads in student hot paths [VERIFIED]
- `dashboard-data/route.ts:108-113` — 3 reads of the same `active_trips` row (getBusById enrich + getDriversByBusId + direct query) + a Firestore route fetch per dashboard load (~6 external calls).
- `trip-status/route.ts:21,70` — student row fetched twice per poll (`requireTransportEntitlement` + `getStudentProfileAndShift`).
- **Fix:** single fetch passed through; drop per-bus enrich.

### P-8 MED · Dashboard payments: full ledger shipped per load [VERIFIED]
- `admin/dashboard-counts/route.ts:70,120` — `payments.select('amount, source')` with no limit → whole ledger summed in JS. Grows with all payments ever made.
- **Fix:** PG aggregate (`sum(amount)` RPC).

### P-9 MED · `getBusById` = 2 queries by design
- `fleet.repository.pg.ts:135-148,174-180` — bus row + active_trips enrich per call, pervasive across bus routes (not in loops, but 2 round trips each). List variant does it right.
- **Fix:** accept or 2s cache for single lookups.

### P-10 MED · Import cycles in the WS core [VERIFIED]
- `socket-router.ts:9` ↔ `websocket-server.ts:11`; `subscription-manager.ts:2` ↔ `socket-router.ts:4` — circular, works only because references are deferred to runtime. Any future top-level use during module evaluation → `undefined`.
- **Fix:** move `broadcastToChannel`/`sendToSocket` to a leaf module.

### P-11 LOW · `tokenAuthCache` prune-only-when->1000
- `server/authenticator.ts:58-63` — expired entries linger until size crosses 1000; at 10k concurrent users it hovers near cap with dead entries. Add a periodic sweep like rate-limiter.

## Clean classes (verified — no findings)
- **Timers:** auth timeout cleared on success; all heartbeat/cleanup timers are singletons with stop paths. No per-connection timer leaks.
- **Listeners:** Path B `onMessage` removed on auth; `bufferMessage` removed post-auth. No leaks beyond socket lifetime.
- **Sync blocking:** JSON.stringify once per broadcast (not per socket); no blocking op in the per-message loop; encryption not used in listing loops.
- **Client state:** pendingSubscriptions/handlers bounded and cleared on unsubscribe/disconnect.
- **Other maps:** nonces (30s TTL), offline-queue (500/socket cap + 60s TTL), breadcrumb/heartbeat write caches (5000 caps), tripLockCache (10s) — all bounded.

## Hot-path profile estimates
| Path | Per invocation | @ scale |
|---|---|---|
| GPS push | 1 RSA verify (~1-2ms), 1 awaited PG write (P-1), 2 encodes, 1 Redis publish | ~100 awaited writes/s; 15-30ms p99 driven by P-1 |
| WS per-message (location) | parse + validate + 3 rate ops + 2× broadcast | 120k socket writes/s at 60 subs/bus — feasible; waste = dead `bus:` channel + empty-subscriber encodes |
| Student track-bus | 2-3 PG reads (1 duplicated) + WS subscribe | ~4-6k reads/s at 2000 students polling 5s |
| Dashboard load | ~6 external calls (P-7) | burst on session start |
| Trip start/end, approval | RPC-based, few round trips | per-event — clean |

## Top 5 fixes by bang-for-buck
1. P-1 throttle the GPS heartbeat write (removes ~95% of DB writes and the p99 latency driver).
2. P-3/P-5/P-6-cleanup — three tiny diffs that kill the only O(n²) churn and the two unbounded maps.
3. P-2 pagination + projection (prevents multi-thousand-row PII dumps).
4. P-6 zero-subscriber short-circuit + single encode + drop dead channel (−2000 publishes/s).
5. P-7 single `active_trips` + student fetch per request.

## Confidence
HIGH — P-1..P-3, P-5..P-7 re-verified against source this session; P-4/P-8..P-11 agent-verified with cited lines.
