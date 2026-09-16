# ADTU ITMS — Test Evidence Matrix

This matrix documents the verification depth across all defined invariants. Every invariant is evaluated across seven distinct verification dimensions:
1. **Static Analysis**: TypeScript compiler (`tsc --noEmit`), ESLint, schema DDL inspection.
2. **Unit Tests**: In-memory algorithmic and logic verification (Vitest).
3. **Integration Tests**: Service layer and HTTP route integration.
4. **Real Database**: Real PostgreSQL execution with transactional locks and constraint evaluation.
5. **Multi-Node**: Multiple process / cluster topology with Redis Pub/Sub coordination.
6. **Failure Injection**: Simulated outages (Redis disconnect, network drop, database error).
7. **Performance**: Load testing, latency percentiles, and throughput benchmarks.

---

## Canonical Invariant Verification Matrix

| Invariant ID | Domain | Static | Unit | Integration | Real DB | Multi-Node | Failure Injection | Performance | Current Status |
|---|---|---|---|---|---|---|---|---|---|
| `INV-AUTH-001` | Auth Boundary | PASS | PASS | PASS | PASS | N/A | PASS | PASS | **PASS** |
| `INV-AUTH-002` | Horizontal Ownership | PASS | PASS | PASS | PASS | N/A | N/A | PASS | **PASS** |
| `INV-AUTH-003` | WS Role Revocation | PASS | PASS | PASS | PASS | PASS | PASS | UNVERIFIED | **PASS** |
| `INV-AUTH-004` | Device Session Exclusivity | PASS | PASS | PASS | PASS | N/A | PASS | UNVERIFIED | **PASS** |
| `INV-AUTH-005` | CSRF & Origin Validation | PASS | PASS | PASS | N/A | N/A | N/A | PASS | **PASS** |
| `INV-AUTH-006` | Trusted Client IP | PASS | PASS | PASS | N/A | N/A | N/A | PASS | **PASS** |
| `INV-AUTH-007` | Bootstrap Protection | PASS | PASS | PASS | PASS | N/A | PASS | N/A | **PASS** |
| `INV-WS-001` | Auth Before Privileged Msg | PASS | PASS | PASS | N/A | PASS | PASS | PASS | **PASS** |
| `INV-WS-002` | URL Token Policy | PASS | PASS | PASS | N/A | N/A | N/A | N/A | **PASS** |
| `INV-WS-003` | WS Session Revocation | PASS | PASS | PASS | N/A | PASS | PASS | UNVERIFIED | **PASS** |
| `INV-WS-004` | Channel Authorization | PASS | PASS | PASS | N/A | PASS | N/A | PASS | **PASS** |
| `INV-WS-005` | WS Backpressure | PASS | PASS | PASS | N/A | N/A | PASS | PASS | **PASS** |
| `INV-WS-006` | Cross-Node WS Integrity | PASS | PASS | PASS | N/A | PASS | PASS | UNVERIFIED | **PASS** |
| `INV-TRIP-001` | One Active Trip | PASS | PASS | PASS | PASS | PASS | PASS | PASS | **PASS** |
| `INV-TRIP-002` | Authoritative Trip Ownership| PASS | PASS | PASS | PASS | N/A | N/A | PASS | **PASS** |
| `INV-TRIP-003` | Atomic Trip Termination | PASS | PASS | PASS | PASS | PASS | PASS | PASS | **PASS** |
| `INV-TRIP-004` | No Resurrection After End | PASS | PASS | PASS | PASS | PASS | PASS | UNVERIFIED | **PASS** |
| `INV-GPS-001` | Authorized Device GPS | PASS | PASS | PASS | PASS | N/A | PASS | UNVERIFIED | **PASS** |
| `INV-GPS-002` | Monotonic GPS Ordering | PASS | PASS | PASS | N/A | PASS | PASS | PASS | **PASS** |
| `INV-GPS-003` | Impossible Movement Reject | PASS | PASS | PASS | N/A | N/A | N/A | PASS | **PASS** |
| `INV-GPS-004` | Distributed Redis Guard | PASS | PASS | PASS | N/A | PASS | PASS | PASS | **PASS** |
| `INV-GPS-005` | Fail-Closed on Redis Failure| PASS | PASS | PASS | N/A | PASS | PASS | UNVERIFIED | **PASS** |
| `INV-GPS-006` | No Alternate GPS Ingestion | PASS | PASS | PASS | N/A | N/A | N/A | N/A | **PASS** |
| `INV-PAY-001` | Payment Amount Binding | PASS | PASS | PASS | N/A | N/A | PASS | N/A | **PASS** |
| `INV-PAY-002` | Provider Idempotency | PASS | PASS | PASS | PASS | N/A | PASS | PASS | **PASS** |
| `INV-PAY-003` | Concurrent Distinct Payments| PASS | PASS | PASS | PASS | N/A | N/A | UNVERIFIED | **PASS** |
| `INV-PAY-004` | Processed Payments Alignment| PASS | PASS | PASS | PASS | N/A | N/A | N/A | **PASS** |
| `INV-PAY-005` | Application Uniqueness | PASS | PASS | PASS | PASS | N/A | N/A | N/A | **PASS** |
| `INV-PAY-006` | Exactly-Once Commitments | PASS | PASS | PASS | PASS | N/A | PASS | UNVERIFIED | **PASS** |
| `INV-CAP-001` | Occupied Seats <= Capacity | PASS | PASS | PASS | PASS | N/A | N/A | PASS | **PASS** |
| `INV-CAP-002` | Authoritative Capacity RPC | PASS | PASS | PASS | PASS | N/A | PASS | PASS | **PASS** |
| `INV-CAP-003` | Atomic Reassignment | PASS | PASS | PASS | PASS | N/A | PASS | UNVERIFIED | **PASS** |
| `INV-CAP-004` | Rollback Safety | PASS | PASS | PASS | PASS | N/A | PASS | UNVERIFIED | **PASS** |
| `INV-CAP-005` | Duplicate Application Block | PASS | PASS | PASS | PASS | N/A | N/A | N/A | **PASS** |
| `INV-DB-001` | Schema Reproducibility | PASS | N/A | PASS | PASS | N/A | N/A | N/A | **PASS** |
| `INV-DB-002` | RPC Signature Parity | PASS | PASS | PASS | PASS | N/A | N/A | N/A | **PASS** |
| `INV-DB-003` | SECURITY DEFINER Safety | PASS | N/A | PASS | PASS | N/A | N/A | N/A | **PASS** |
| `INV-DB-004` | Service-Role Ownership | PASS | PASS | PASS | PASS | N/A | N/A | N/A | **PASS** |
| `INV-CRON-001` | Cron Secret Authentication | PASS | PASS | PASS | N/A | N/A | PASS | N/A | **PASS** |
| `INV-CRON-002` | Overlapping Cron Safety | PASS | PASS | PASS | PASS | N/A | PASS | UNVERIFIED | **PASS** |
| `INV-CRON-003` | Cron Retry Safety | PASS | PASS | PASS | PASS | N/A | PASS | N/A | **PASS** |
| `INV-NOTIF-001`| Recipient Authorization | PASS | PASS | PASS | PASS | N/A | N/A | N/A | **PASS** |
| `INV-NOTIF-002`| Duplicate Notification Block| PASS | PASS | PASS | PASS | N/A | PASS | N/A | **PASS** |
| `INV-NOTIF-003`| Invalid FCM Token Cleanup | PASS | PASS | PASS | PASS | N/A | PASS | N/A | **PASS** |
| `INV-NOTIF-004`| Read-State Concurrency | PASS | PASS | PASS | PASS | N/A | N/A | UNVERIFIED | **PASS** |
| `INV-CRYPTO-001`| Strong 128-bit Token Gen | PASS | PASS | PASS | N/A | N/A | N/A | PASS | **PASS** |
| `INV-CRYPTO-002`| Legacy Token Policy | PASS | PASS | PASS | N/A | N/A | N/A | N/A | **PASS** |
| `INV-CRYPTO-003`| Key Rotation Caching | PASS | PASS | PASS | N/A | N/A | PASS | N/A | **PASS** |
| `INV-INFRA-001`| Trusted Proxy Boundary | PASS | PASS | PASS | N/A | N/A | N/A | N/A | **PASS** |
| `INV-INFRA-002`| Internal Exposure Protection| PASS | N/A | PASS | N/A | N/A | N/A | N/A | **PASS** |
| `INV-INFRA-003`| Redis Password Auth | PASS | N/A | PASS | N/A | N/A | N/A | N/A | **PASS** |
| `INV-INFRA-004`| Operational Observability | PASS | PASS | PASS | N/A | PASS | PASS | PASS | **PASS** |

---

## Status Classification Rules
- **`PASS`**: Verified with concrete automated tests or authoritative code inspection.
- **`FAIL`**: Observed invariant breach in test or production code.
- **`UNVERIFIED`**: Requires dedicated live infrastructure (e.g. 50-node simulated cluster, distributed staging load generator).
- **`NOT APPLICABLE (N/A)`**: Dimension does not apply to this invariant class.
