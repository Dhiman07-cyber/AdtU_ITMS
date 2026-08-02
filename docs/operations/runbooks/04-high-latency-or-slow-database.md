# Operational Runbook 04: High Latency or Slow Database Response

## Symptom
Prometheus alert `HighResponseLatency` fires or p99 HTTP API response latency > 1,000ms.

---

## 1. Diagnostics Procedure

1. **Inspect Prometheus Metrics**:
   Open Grafana (`http://localhost:3002`) → Check "API Latency p95/p99" and "Postgres Active Queries".

2. **Query Supabase Slow Queries**:
   Run in Supabase SQL editor:
   ```sql
   SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
   FROM pg_stat_activity
   WHERE state != 'idle' AND (now() - pg_stat_activity.query_start) > interval '2 seconds'
   ORDER BY duration DESC;
   ```

3. **Check NGINX Ingress Rate Limits**:
   Inspect NGINX error logs for 503 or 429 rate limit triggers:
   ```bash
   docker compose logs --tail 100 nginx | grep "limiting requests"
   ```

---

## 2. Remediation

- **Cancel Blocking Locks**: If a long-running transaction is blocking active trip writes:
  ```sql
  SELECT pg_cancel_backend(pid);
  ```
- **Scale Instance / Connection Pool**: Increase Supabase pool size or verify `tripLockCache` TTL is absorbing redundant checks.
