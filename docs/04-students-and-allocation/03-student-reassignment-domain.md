# Admin & Moderator Student Reassignment Domain

## 1. Domain Overview & Operational Scope

The **Student Reassignment Domain** enables University Administrators and authorized Moderators to dynamically rebalance passenger distributions across the transit fleet without data loss, overbooking, or transit disruption.

> **CRITICAL BOUNDARY:** This document exclusively covers **Student Reassignment** (migrating enrolled students between buses, routes, stops, and shifts). Vehicle fleet allocations and driver roster assignments are managed in separate operational domains.

### Reassignment Scenarios
1. **Capacity Overload Relief:** Relieving an over-subscribed bus by migrating passengers to an under-utilized vehicle serving overlapping corridors.
2. **Application Capacity Review Resolution:** Resolving Case 3 applications (`bus_full_only_option`) where a student applied for a full bus and needs assignment to a staged alternative.
3. **Shift Adjustments:** Accommodating student class timetable changes (transferring between Morning and Evening shifts).
4. **Relocation & Stop Changes:** Updating a student's designated boarding point when their residential address changes.
5. **Bulk Fleet Rebalancing:** Mass-migrating groups of students following route restructuring or new vehicle commissioning.

```
       ┌────────────────────────────────────────────────────────┐
       │             ADMINISTRATOR / MODERATOR ACTION           │
       │    Initiates Single or Bulk Reassignment (/admin/smart)│
       └──────────────────────────┬─────────────────────────────┘
                                  │
                                  ▼
       ┌────────────────────────────────────────────────────────┐
       │             MODERATOR PERMISSION GUARD                 │
       │      requireModeratorPermission('students',            │
       │             'canReassign')                             │
       └──────────────────────────┬─────────────────────────────┘
                                  │
                                  ▼
       ┌────────────────────────────────────────────────────────┐
       │         POSTGRESQL ATOMIC RPC TRANSACTION              │
       │      public.reassign_students_atomically(p_plans)      │
       │                                                        │
       │  1. FOR UPDATE lock on each student profile            │
       │  2. Resolve old shift & new shift                      │
       │  3. Decrement source bus shift load (if active seat)   │
       │  4. Increment target bus shift load under FOR UPDATE   │
       │     ► Aborts batch if target exceeds physical capacity │
       │  5. Update student (bus_id, route_id, shift, stop_name)│
       │  6. Recalculate exact bus loads from active profiles   │
       └───────┬────────────────────────────────────────┬───────┘
               │                                        │
               ▼ Succeeded                              ▼ Failed (Capacity / Error)
┌──────────────────────────────┐         ┌──────────────────────────────┐
│  REASSIGNMENT LOG CREATED    │         │      TRANSACTION ABORTED     │
│  - Snapshots before/after    │         │  - Zero partial transfers    │
│  - status: 'committed'       │         │  - Database state unchanged  │
│  - Eligible for Rollback     │         └──────────────────────────────┘
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  NOTIFICATIONS DISPATCHED    │
│  - Student: Reassignment msg │
│  - Driver: New passenger cnt │
└──────────────────────────────┘
```

---

## 2. Database Concurrency & Atomic RPC Architecture

Student reassignment modifies multiple interrelated tables simultaneously: `student_profiles`, source vehicle counters in `buses`, target vehicle counters in `buses`, and `reassignment_logs`. Executing these across loose client-side requests causes data corruption during concurrent execution.

All student reassignments are executed strictly through the PostgreSQL stored procedure:
`public.reassign_students_atomically(p_plans JSONB)`

### 2.1 RPC Signature & Arguments
```sql
CREATE OR REPLACE FUNCTION public.reassign_students_atomically(p_plans JSONB)
RETURNS JSONB
```

The payload `p_plans` is a JSON array of transfer specifications:
```json
[
  {
    "studentId": "usr_stu_109284",
    "fromBusId": "BUS-101",
    "toBusId": "BUS-105",
    "studentShift": "Evening",
    "stopName": "Paltan Bazar Station"
  }
]
```

### 2.2 Execution Steps Inside the Database Transaction
1. **Row-Level Student Locking:**
   ```sql
   SELECT uid, shift, bus_id, stop_name
   INTO v_student
   FROM student_profiles
   WHERE uid = v_student_id
   FOR UPDATE;
   ```
   Acquires an exclusive lock on each student record, preventing concurrent mutations or race conditions with renewal payments.
2. **Shift Resolution:**
   - Evaluates the student's existing shift (`v_old_shift`) and target shift (`v_new_shift`).
   - Normalizes shifts to lowercase (`'morning'` or `'evening'`).
3. **Source Bus Capacity Decrement:**
   - Invokes `bus_decrement_capacity(v_from_bus_id, v_old_shift)`.
   - Decrements the specific shift counter (`morning_load` or `evening_load`) by 1.
4. **Target Bus Capacity Guard & Increment:**
   - Invokes `bus_increment_capacity(v_to_bus_id, v_new_shift)`.
   - Acquires `FOR UPDATE` lock on the destination bus.
   - Evaluates `shift_load < capacity`.
   - **Strict Abort Invariant:** If the destination bus is full, the stored procedure raises an exception:
     `'Capacity exceeded during reassignment for bus %'`
     PostgreSQL automatically rolls back the entire batch. **Zero partial transfers can occur**.
5. **Student Record Update:**
   - Updates `student_profiles` with `bus_id = v_to_bus_id`, `route_id = v_target_route_id`, `shift = v_new_shift`, and `stop_name = v_stop_name`.
6. **Deterministic Ground-Truth Recount:**
   - After processing all students in the batch, the procedure queries active profiles to set exact counts:
     ```sql
     UPDATE buses b SET
         morning_load = (SELECT COUNT(*) FROM student_profiles sp WHERE sp.bus_id = b.id AND LOWER(sp.shift) = 'morning' AND sp.status = 'active'),
         evening_load = (SELECT COUNT(*) FROM student_profiles sp WHERE sp.bus_id = b.id AND LOWER(sp.shift) = 'evening' AND sp.status = 'active'),
         current_members = (SELECT COUNT(*) FROM student_profiles sp WHERE sp.bus_id = b.id AND sp.status = 'active'),
         updated_at = NOW()
     WHERE b.id = v_to_bus_id;
     ```
   - Eliminates drift and guarantees 100% mathematical precision.

---

## 3. Reassignment Logs & The Rollback Engine

Every committed reassignment creates an immutable record in `public.reassignment_logs` with a unique `operation_id` (`reassignment_logs/write`):

```json
{
  "operationId": "student_reassignment_1772701200_abc123",
  "type": "student_reassignment",
  "status": "committed",
  "actorId": "usr_adm_99182",
  "summary": "Reassigned 12 students from Bus-101 to Bus-105",
  "changes": [
    {
      "collection": "students",
      "docId": "usr_stu_109284",
      "before": { "busId": "BUS-101", "shift": "Morning", "stopName": "Six Mile" },
      "after": { "busId": "BUS-105", "shift": "Evening", "stopName": "Paltan Bazar" }
    }
  ]
}
```

### 3.1 The Rollback Mechanism (`execute_reassignment_rollback`)
If an administrator makes an error, the system provides an instant rollback capability via `/api/reassignment-logs/rollback`, executed through the PostgreSQL RPC:
`public.execute_reassignment_rollback(p_operation_id, p_actor_id, p_actor_label, p_changes)`

#### Rollback Precondition Validation (Strict Safety)
Before executing a reversal, the RPC inspects every student affected by the original operation:
1. **Existence Check:** Confirms the student still exists in `student_profiles`. If a student was deleted, rollback halts with an error.
2. **Current State Verification:** Confirms `student_profiles.bus_id == change.after.bus_id`.
   - **Crucial Invariant:** If a student was subsequently reassigned to a third bus by another administrator, or updated their shift independently, the rollback **aborts immediately** with:
     `'Precondition failed: Student {uid} busId has changed since the reassignment'`
   - Prevents stale rollbacks from clobbering newer administrative decisions.

#### Atomic Rollback Execution
When preconditions pass:
1. Each student is restored to their exact `before` state (`bus_id`, `route_id`, `shift`, `stop_name`).
2. Bus counters (`morning_load`, `evening_load`, `current_members`) are recalculated directly from active profiles.
3. The original reassignment log record is updated to `status = 'rolled_back'` with `meta.rolledBackAt` timestamp.
4. An audit event is recorded: `action: 'reassignment_rolled_back'`.

---

## 4. Edge Cases & Resilience Handlers

### 4.1 Reassigning Soft-Blocked Students (Seat Already Released)
- When a student is soft-blocked for non-payment, the automated cleanup cron releases their seat quota back to the fleet (`soft_block_student_with_seat_release` sets `seatReleasedAt = NOW()` and decrements the bus load).
- **The Pitfall:** If an administrator reassigns this student, decrementing the source bus would cause an erroneous negative decrement (subtracting a seat that was already returned to inventory).
- **Enforcement:** The system checks `wasSeatReleased(student)`. If the seat was already released, the source bus decrement is skipped, and the destination bus only increments if the student is being actively restored.

### 4.2 Reassignment During Active Trips
- A student might be reassigned while an active trip is ongoing on their old bus.
- **Waiting Flag Handling:** If the student had raised a waiting flag (`status: 'raised'` or `'acknowledged'`) on their previous bus, the system cancels the active waiting flag. The student's live tracking interface dynamically updates to their new bus stream upon their next polling or socket reconnect frame.
- **Boarding Pass Invalidation:** Because digital passes contain the signed `busId`, attempting to scan the old pass on the previous bus immediately triggers the red scanner alert (`DENIED: WRONG BUS`).

### 4.3 Destination Bus Capacity Overflow in Bulk Batches
- When reassigning a batch of 20 students, the destination bus may have only 12 available seats remaining.
- **Fail-Closed Atomicity:** The RPC evaluates capacity on every student increment. When student #13 triggers `CAPACITY_FULL`, the entire transaction aborts. Students 1 through 12 are NOT transferred. The system returns an explicit error to the administrator, leaving both source and destination fleet states intact.

### 4.4 Deadlock Prevention Between Concurrent Reassignments
- If Admin A reassigns students from Bus 1 to Bus 2 while Admin B reassigns students from Bus 2 to Bus 1, concurrent transactions could deadlock waiting on row locks.
- **Deadlock Avoidance:** Stored procedures sort affected bus IDs deterministically before acquiring row locks (`ORDER BY bus_id ASC`). Both transactions request locks in identical sequence, eliminating deadlock cycles.

---

## 5. Security & Moderator Role Permissions

Student reassignment is restricted:
- **Full Administrators (`admin`):** Full, unrestricted reassignment capability across all buses, shifts, and routes.
- **Moderators (`moderator`):** Completely forbidden by default (`canReassign: false`).
  - Gated by `requireModeratorPermission(auth, 'students', 'canReassign')`.
  - Reassignment endpoints return HTTP 403 Forbidden unless the master administrator has explicitly toggled `students.canReassign = true` in the moderator's granular permissions profile.
- **Audit Logging:** Every reassignment operation logs actor identity, IP address, timestamp, and transferred student count to `public.audit_events`.
