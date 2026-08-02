# Operational Runbook 06: Backup Verification & Rollback Drills Procedure

## 1. Automated Monthly Backup Restoration Verification

**Frequency**: Monthly (First Sunday of every month).  
**Objective**: Prove database backups are 100% valid and restorable to zero-data-loss state.

### Execution Procedure:
1. Download latest daily Supabase PostgreSQL automated backup artifact (`.sql` / WAL stream).
2. Spin up a temporary staging Postgres Docker container:
   ```bash
   docker run --name pg-restore-test -e POSTGRES_PASSWORD=test -p 5433:5432 -d postgres:16-alpine
   ```
3. Restore backup into staging container:
   ```bash
   docker exec -i pg-restore-test psql -U postgres < ./supabase-backup-latest.sql
   ```
4. Run schema & data integrity assertions:
   ```bash
   npx tsx scripts/diagnose.ts --db-host 127.0.0.1 --db-port 5433
   ```
5. Log verification evidence in SRE audit log and terminate test container.

---

## 2. Quarterly Rollback Drill

**Frequency**: Quarterly.  
**Objective**: Practice zero-downtime application rollback under simulated failure.

### Drill Procedure:
1. Trigger a deployment of a dummy test image version to staging environment.
2. Inject a simulated health check failure (e.g. invalid environment variable).
3. Execute automated rollback pipeline:
   ```bash
   npm run rollback:compose
   ```
4. Measure rollback execution time (target: `< 60 seconds`).
5. Verify health checks pass and WebSocket connections recover without dropping active sessions.
