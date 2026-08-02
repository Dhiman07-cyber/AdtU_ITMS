# Operational Runbook 03: Redis Down or Partitioned

## Symptom
Log warning `redis_connection_failed` or `redis_broadcast_relay_init_failed`. Cross-node broadcast stops or local redis health check fails.

---

## 1. Quick Diagnostics

1. **Check Container Status**:
   ```bash
   docker compose ps redis
   ```
2. **Ping Redis Container**:
   ```bash
   docker exec -it itms-redis redis-cli ping
   ```
   Expected response: `PONG`.

3. **Check Memory Usage**:
   ```bash
   docker exec -it itms-redis redis-cli info memory
   ```

---

## 2. Recovery Action

- **Restart Container**:
  ```bash
  docker compose restart redis
  ```
- **Verify WebSocket Auto-Reconnect**:
  WebSocket servers automatically re-attempt Redis connection every 5 seconds. Check WS logs to confirm reconnection:
  ```bash
  docker compose logs --tail 50 ws1 | grep "redis"
  ```
- **Single-Node Fallback**:
  In single-node (Program 008A), if Redis fails, local WebSocket broadcasting to clients connected on the same node continues without crashing.
