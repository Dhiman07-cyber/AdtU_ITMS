# Operational Runbook 01: Driver Cannot Start Trip

## Symptom
Driver clicks "Start Trip" in mobile client, but receives an error dialog ("Conflict", "Driver assigned to active trip", or "Lock failed") or the button spins indefinitely.

---

## 1. Quick Triage Steps (under 2 minutes)

1. **Check Driver Auth & Session Token**:
   - Verify Firebase auth state in driver app logs. Expired token returns 401/403.
   - Force app restart or clear browser cache to force token refresh.

2. **Inspect Preflight API Response**:
   - Query endpoint `/api/driver/start-trip` in server logs:
     ```bash
     docker compose logs --tail 100 nextjs | grep "start-trip"
     ```
   - Look for `"reason": "Driver already assigned to active trip ..."` or `"bus_in_use"`.

3. **Check Supabase `active_trips` Lock Table**:
   - Open Supabase SQL Editor or run query:
     ```sql
     SELECT * FROM active_trips WHERE driver_id = 'DRIVER_UID' OR bus_id = 'BUS_ID';
     ```
   - If an expired or abandoned lock exists (e.g. driver closed app without ending previous trip):
     - Check `expires_at`. If past expiry, run lock cleanup:
       ```sql
       SELECT cleanup_stale_locks();
       ```
     - If lock is stuck open manually:
       ```sql
       UPDATE active_trips SET status = 'completed', ended_at = NOW() WHERE trip_id = 'STUCK_TRIP_ID';
       ```

---

## 2. Escalation & Deep Dive

- **DB Pool Lockup**: Check Supabase connection limits (`pg_stat_activity`). If connections are maxed out, check if `checkActiveTrip` or `location/update` queries are spiking connection pool.
- **RPC acquire_trip_lock Rejection**: If RPC fails with custom PostgreSQL error, inspect lock table constraints (`active_trips_bus_id_key`).
