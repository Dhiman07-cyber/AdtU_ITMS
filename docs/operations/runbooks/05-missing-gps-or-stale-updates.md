# Operational Runbook 05: Missing GPS or Stale Location Updates

## Symptom
Driver app appears active, but location coordinates on student maps are older than 60 seconds.

---

## 1. Diagnostics

1. **Verify GPS Heartbeat in Server Logs**:
   ```bash
   docker compose logs --tail 100 ws1 | grep "location_update"
   ```
2. **Check Driver Device Location Permission & OS Doze Mode**:
   Mobile OS (Android/iOS) power management may suppress background location updates if driver switches apps.
3. **Verify Stale Lock Cleanup Cron**:
   Ensure stale trip cleanup job is running. Check route `/api/cron/cleanup-stale-locks`.

---

## 2. Remediation

- Driver must re-open the driver dashboard app to wake up background location permissions.
- If socket disconnected without close frame, WebSocket server heartbeat timer (ping/pong every 30s) will terminate dead socket within 60s.
