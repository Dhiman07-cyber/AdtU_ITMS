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

### The Solution: Atomic PostgreSQL Capacity Reservation
The database prevents overbooking through a dedicated stored procedure utilizing `FOR UPDATE` row locking:

```sql
CREATE OR REPLACE FUNCTION public.bus_increment_capacity(p_bus_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_bus RECORD;
BEGIN
    SELECT id, capacity, current_occupancy
    INTO v_bus
    FROM public.buses
    WHERE id = p_bus_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'reason', 'Bus not found');
    END IF;

    IF v_bus.current_occupancy >= v_bus.capacity THEN
        RETURN jsonb_build_object('success', false, 'reason', 'Bus is at maximum capacity');
    END IF;

    UPDATE public.buses
    SET current_occupancy = current_occupancy + 1,
        updated_at = clock_timestamp()
    WHERE id = p_bus_id;

    RETURN jsonb_build_object('success', true, 'remaining_seats', v_bus.capacity - v_bus.current_occupancy - 1);
END;
$$;
```

---

## 3. Dynamic Reassignment & Smart Alternatives

When a requested bus reaches 100% occupancy:
1. **Alternative Bus Suggestion (`AlternativeBusPicker.tsx`)**:
   - The system inspects neighboring buses running the same route or overlapping stops.
   - Proposes alternative vehicles with available seating capacity in the same shift window (Morning/Evening).
2. **Bulk Reassignment (`ReassignmentPanel.tsx`)**:
   - Administrators can migrate an entire batch of students from an overloaded bus to a newly provisioned vehicle.
   - Automatically updates `student_profiles.bus_id` and dispatches push notifications to affected students.
