# Operational Incident Runbooks & Troubleshooting

## 1. Runbook: Stuck Driver Trip Lock

### Symptoms
- Driver attempts to start their morning trip and receives error: `DRIVER_ALREADY_ACTIVE` or `LOCKED_BY_OTHER`.
- A bus appears as "In Transit" on admin dashboards hours after the route concluded.

### Root Cause
The driver terminated the mobile browser session without tapping "End Trip", or their device experienced sudden battery loss in a network dead-zone before the end-trip API call completed.

### Resolution Steps
1. **Automated Expiry**: The `active_trips` lock holds a 10-minute TTL (`expires_at`). If no heartbeat arrives for 10 minutes, the lock expires automatically.
2. **Immediate Administrative Release**:
   - Navigate to **Admin Dashboard -> Live Fleet Operations**.
   - Select the stranded bus and tap **Force Terminate Trip**.
   - Alternatively, execute the cleanup RPC via database console:
     ```sql
     SELECT public.end_trip_atomically('<trip_id>', '<driver_id>', '<bus_id>');
     ```
3. **Verify State**:
   - Query `active_trips` to ensure status is `ended`:
     ```sql
     SELECT * FROM public.active_trips WHERE bus_id = 'BUS-101' AND status = 'active';
     ```

---

## 2. Runbook: Redis Partition / Inter-Node Desynchronization

### Symptoms
- Driver transmits GPS coordinates successfully on WebSocket Node 1, but students connected to WebSocket Node 2 see no movement.
- Prometheus metric `itms_redis_pubsub_messages_total` stops incrementing.

### Diagnostic & Recovery
1. **Verify Redis Container Health**:
   ```bash
   docker exec -it itms-redis redis-cli ping
   # Expected: PONG
   ```
2. **Inspect Node Logs**:
   ```bash
   docker compose logs ws1 | grep -i "redis"
   docker compose logs ws2 | grep -i "redis"
   ```
3. **Restart Broker**:
   ```bash
   docker compose restart redis
   ```
   *Note: In-process single-node delivery continues unaffected while Redis restarts.*

---

## 3. Runbook: Ghost Bus Pins After Route Completion

### Symptoms
- Students view a bus icon parked at the final campus stop with an "Ended" badge, but the pin does not dismiss.

### Resolution Steps
1. **Purge Database Location Cache**:
   ```sql
   DELETE FROM public.bus_locations WHERE bus_id = 'BUS-101';
   ```
2. **Trigger Trip Cleanup Broadcast**:
   - Dispatch an administrative trip-end broadcast:
     ```bash
     npm run maintenance:status
     ```
   - Verify that client browsers receive the `trip_ended` socket frame, which clears the local MapLibre marker reference.

---

## 4. Runbook: Planned Maintenance Mode Toggle

To perform database schema migrations or container upgrades without showing 500 error screens to students:

1. **Enable Maintenance Mode**:
   ```bash
   npm run maintenance:on -- --reason "Database migration"
   ```
   - Writes the sentinel flag file `.maintenance-active`.
   - Next.js edge proxy immediately intercepts incoming requests and returns a branded 503 Maintenance page.

2. **Verify System Health**:
   ```bash
   npm run health:check
   ```

3. **Disable Maintenance Mode**:
   ```bash
   npm run maintenance:off
   ```

---

## 5. Diagnostic Command Reference

| Command | Operational Purpose |
| :--- | :--- |
| `npm run diagnose` | Collects full runtime state, memory usage, git commit, and service health into a structured JSON report. |
| `npm run incident:bundle` | Automatically dumps a timestamped diagnostic bundle and plain-text summary into `incident-bundles/` for post-mortems. |
| `npm run health:check` | Polls all platform health endpoints with retry logic and exits 1 if any critical target is unresponsive. |
| `npm run wait:healthy` | Startup readiness polling loop used in CI/CD deployment pipelines. |
| `npm run validate:config` | Detects configuration drift, missing `.env` parameters, and unpinned Docker image tags. |
