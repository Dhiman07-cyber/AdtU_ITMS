# Smart Seat Allocation, Routes & Capacity Management

## 1. Route & Stop Architecture

University bus routes are defined in the `routes` table with structured stops containing geographic coordinates and ordered pickup sequences:

```json
{
  "id": "route_1",
  "route_name": "Jalukbari to AdtU Campus via Paltan Bazar",
  "status": "active",
  "stops": [
    { "name": "Jalukbari Flyover", "lat": 26.1445, "lng": 91.6621, "order": 1 },
    { "name": "Maligaon Gate 3", "lat": 26.1552, "lng": 91.6984, "order": 2 },
    { "name": "Paltan Bazar Station", "lat": 26.1812, "lng": 91.7533, "order": 3 },
    { "name": "Six Mile Supermarket", "lat": 26.1284, "lng": 91.7995, "order": 4 },
    { "name": "AdtU Campus Gate", "lat": 26.1132, "lng": 91.8764, "order": 5 }
  ]
}
```

---

## 2. Bus Capacity Invariants & Overbooking Prevention

Every vehicle record in `buses` defines a maximum physical seating capacity (typically 45–55 seats).

### The Overbooking Race Condition
When hundreds of students complete registration simultaneously during semester intake, naive applications suffer from Time-of-Check to Time-of-Use (TOCTOU) race conditions: two students both see "1 seat available", book concurrently, and overload the vehicle.

### The Solution: Atomic PostgreSQL Capacity Reservation & Shift Tracking
The database prevents overbooking through dedicated stored procedures utilizing `FOR UPDATE` row locking against specific shift loads (`morning_load` and `evening_load`):

```sql
-- Atomic check and reservation on bus shift load
SELECT id, capacity, morning_load, evening_load
FROM public.buses
WHERE id = p_bus_id
FOR UPDATE;
```

---

## 3. Dynamic Reassignment & Smart Alternatives

When a requested bus reaches 100% occupancy:
1. **Alternative Bus Suggestion (`AlternativeBusPicker.tsx`)**:
   - The system inspects neighboring buses running the same route or overlapping stops.
   - Proposes alternative vehicles with available seating capacity in the same shift window (Morning/Evening).
2. **Atomic Bulk Reassignment (`reassign_students_atomically`)**:
   - Administrators migrate batches of students via the atomic RPC `reassign_students_atomically`.
   - **Deadlock Avoidance**: Locks affected bus records in ascending identifier order (`ORDER BY bus_id`).
   - **Strict Capacity Guarantee**: Aborts and rolls back the entire batch if the destination bus exceeds its physical capacity threshold.
   - **Audit & Rollback**: Persists an immutable snapshot in `reassignment_logs`, allowing administrators to execute an instant rollback via `execute_reassignment_rollback` if route requirements change.
