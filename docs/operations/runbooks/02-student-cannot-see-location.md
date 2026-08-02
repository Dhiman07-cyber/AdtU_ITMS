# Operational Runbook 02: Student Cannot See Live Location

## Symptom
Student map is rendered, but bus marker is missing, static, or shows "Offline" even though driver confirmed trip is active.

---

## 1. Quick Triage Steps

1. **Check Client WebSocket Connection State**:
   - Open browser developer tools → Network → WS.
   - Verify connection to `wss://bus.adtu.edu.in/ws`.
   - Status should be `101 Switching Protocols`.

2. **Verify Channel Subscription**:
   - In browser console, verify subscription message sent:
     `{"type":"subscribe","channel":"bus_location_BUS123"}`
   - Ensure WebSocket server returned `{"type":"subscribed","channel":"bus_location_BUS123"}`.

3. **Check WS Server Ingestion Logs**:
   ```bash
   docker compose logs --tail 100 ws1 | grep "bus_location"
   ```
   - If no GPS updates logged, the driver's device is not transmitting location updates.

---

## 2. Root Causes & Fixes

- **Expired Firebase Token**: If WS connection closes with code `4001` or `4002`, client token expired. Client auto-refreshes, but if network failed, reload page.
- **Redis Pub/Sub Disconnect**: If multi-node setup is active and driver is connected to `ws1` while student is on `ws2`, check if Redis Pub/Sub relay is active:
  ```bash
  docker exec -it itms-redis redis-cli pubsub channels "bus_location*"
  ```
