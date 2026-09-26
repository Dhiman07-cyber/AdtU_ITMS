# Bus Capacity Quota Management, Routes & Allocation Cases

## 1. Architectural Philosophy: Open Seating & Shift Quotas

In the Assam down town University (AdtU) ITMS, **there are NO individual seat reservations, seat numbers, or physical seat assignments**.

- **Open Physical Seating:** When an enrolled student boards their assigned bus, they may sit in any available physical seat.
- **Aggregate Shift Enrollment Quotas:** Vehicle capacity management is enforced strictly as an aggregate headcount limit per operational shift:
  - `buses.capacity`: Maximum physical seating capacity of the vehicle (e.g., 50 seats).
  - `buses.morning_load`: Total count of active students registered for the Morning shift.
  - `buses.evening_load`: Total count of active students registered for the Evening shift.
  - `buses.current_members`: Total unique students registered across all shifts.
- **Shift Independence:** Because morning and evening transit runs operate independently, a 50-passenger bus can accommodate 50 morning students and 50 evening students without exceeding safety limits.

---

## 2. Route & Stop Architecture

University bus routes are stored in the PostgreSQL `routes` table with ordered stops containing geographic coordinates and pickup sequences:

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

Buses are mapped to routes via `buses.route_id`. Multiple buses can serve the same route or share overlapping pickup stops.

---

## 3. Concurrency Protection & Overbooking Prevention

During peak university enrollment windows, hundreds of students submit applications concurrently. Naive read-then-write patterns produce Time-of-Check to Time-of-Use (TOCTOU) race conditions: multiple applicants see "1 seat available" and over-allocate the vehicle.

### 3.1 PostgreSQL Row-Level Locking (`FOR UPDATE`)
To prevent overbooking, capacity changes are executed via PostgreSQL stored procedures acquiring exclusive row-level locks on the target bus:

```sql
-- Atomic check and reservation within bus_increment_capacity RPC
SELECT id, capacity, morning_load, evening_load
FROM public.buses
WHERE id = p_bus_id
FOR UPDATE;

-- Evaluate shift load against capacity limit
IF p_shift = 'morning' AND morning_load >= capacity THEN
    RAISE EXCEPTION 'CAPACITY_FULL';
END IF;
```

If the vehicle's shift quota is exhausted, the database immediately aborts the transaction with `CAPACITY_FULL`, guaranteeing that `load <= capacity` holds continuously.

---

## 4. The Three Student Allocation Cases

When a student applies for transit or submits their registration form, the system evaluates route, stop, shift, and capacity availability through `/api/buses/capacity`:

```
                      [Student Selects Stop & Shift]
                                    │
                                    ▼
                     [System Evaluates Matching Buses]
                                    │
            ┌───────────────────────┼───────────────────────┐
            │                       │                       │
            ▼                       ▼                       ▼
      [CASE 1: IDEAL]       [CASE 2: ALTERNATIVE]    [CASE 3: WORST CASE]
     Primary Bus Has        Primary Bus Full, But     Primary Bus Full, &
    Capacity on Shift      Alternative Bus Exists    NO Other Bus Serves Stop
            │                       │                       │
            ▼                       ▼                       ▼
  needsCapacityReview:    reassignmentReason:       needsCapacityReview:
         FALSE             'bus_full_alternatives_         TRUE
   reassignmentReason:            exist'             reassignmentReason:
       'no_issue'                   │               'bus_full_only_option'
            │                       ▼                       │
            ▼              Student Picks or Is              ▼
     Direct Approval       Assigned Alternative     Admin Review Mandatory;
     Permitted in UI             Vehicle            Direct Approval Locked
```

### 4.1 Case 1: Ideal Case (Primary Bus Available)
- **Precondition:** The bus chosen by the student serves their pickup stop and has available capacity on the requested shift (`shift_load < capacity`).
- **System Behavior:**
  - `canProceed = true`
  - `needsCapacityReview = false`
  - `reassignmentReason = 'no_issue'`
  - UI displays confirmation: `✓ Bus {busNumber} has {availableSeats} available seat(s).`
- **Administrative Processing:** When reviewing the application in `/admin/applications` or `/moderator/applications`, the administrator can approve the student in a single click. The atomic RPC `bus_increment_capacity` commits the allocation immediately.

### 4.2 Case 2: Alternative Bus Available
- **Precondition:** The bus selected by the student is at 100% capacity on that shift (`shift_load >= capacity`), but another bus serves the same pickup stop or route during that shift with available capacity.
- **System Behavior:**
  - `canProceed = true`
  - `isFull = true`
  - `hasAlternatives = true`
  - `reassignmentReason = 'bus_full_alternatives_exist'`
  - `alternativeBuses` payload contains candidate vehicles with available seating.
- **Application UX:**
  - The student UI invokes `AlternativeBusPicker` to present alternative buses.
  - If a single alternative exists, the system notifies: `"The selected bus ({busNumber}) is full. You will be assigned to {altBusNumber} which has {availableSeats} available seat(s)."`
  - If multiple alternatives exist, the student can pick their preferred alternative vehicle before final submission.
- **Administrative Processing:** In the administrative dashboard, the application shows an info badge indicating that alternatives were available. Administrators can approve the student to the alternative bus or stage a reassignment.

### 4.3 Case 3: Worst Case — No Alternative Bus Serves Stop (`bus_full_only_option`)
- **Precondition:** The bus serving the student's stop is completely full (`shift_load >= capacity`), and **NO other bus serves that stop on that shift**.
- **System Behavior:**
  - `canProceed = true` (the student is **never blocked** from submitting an application; the system refuses to abandon students stranded without options).
  - `isFull = true`
  - `hasAlternatives = false`
  - `needsCapacityReview = true`
  - `reassignmentReason = 'bus_full_only_option'`
  - Notification displayed to student: `"The bus ({busNumber}) for your stop is currently full and this is the only bus serving this stop. Your application will be reviewed by the managing team for seat availability after submission."`
- **Administrative Dashboard Guard & Interception:**
  - In `/admin/applications` and `/moderator/applications`, the application is flagged with an amber warning banner: **"Capacity Review Required: Bus Full (Only Option)"**.
  - **Approval Lockout:** Direct one-click approval is strictly disabled (`disabled={needsCapacityReview && !stagedBus}`).
  - Clicking "Approve" intercepts the workflow and forces open the **Reassign Modal** (`ReassignModalTarget`).
  - The administrator or moderator must either:
    1. Select an alternative bus from another route and override the assignment (`overrideBusId`).
    2. Increase the target vehicle's physical capacity in fleet settings if bus size was upgraded.
    3. Reassign an existing student on that bus to another bus via the Smart Allocation / Reassignment domain to free up a slot.
    4. Reject the application with an explanatory note to the student.

---

## 5. Unified Fleet Allocation & Reassignment Architecture (`/admin/smart-allocation`)

To provide an integrated, seamless administrative control center, the system consolidates all passenger, crew, and vehicle allocations into a single, high-performance 3-tab hub at [`/admin/smart-allocation`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/admin/smart-allocation/page.tsx).

```
                      /admin/smart-allocation
                                 │
     ┌───────────────────────────┼───────────────────────────┐
     ▼                           ▼                           ▼
[tab=students]              [tab=drivers]               [tab=buses]
Student Reassignment     Driver Reassignment        Bus Route Allocation
(`StudentReassignmentTab`) (`DriverReassignmentTab`)   (`BusRouteAllocationTab`)
- Rebalances student load  - Assigns drivers to buses - Assigns buses to routes
- Shifts & pickup stops    - Driver reserve status    - Fleet capacity & load
- Atomic RPC rollback      - Live trip lock guard     - Corridor alignment
```

### 5.1 The Three Dedicated Functional Tabs
1. **Student Reassignment Tab ([`StudentReassignmentTab.tsx`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/components/smart-allocation/StudentReassignmentTab.tsx)):**
   - Single and bulk passenger migration between vehicles, routes, stops, and shifts.
   - Guarded by atomic PostgreSQL RPC `reassign_students_atomically` and rollback engine `execute_reassignment_rollback`.
   - Requires `students.canReassign` permission for moderators.
2. **Driver Reassignment Tab ([`DriverReassignmentTab.tsx`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/components/smart-allocation/DriverReassignmentTab.tsx)):**
   - Reassigns drivers across vehicles and shifts (`assign_drivers_atomically`).
   - Prevents assignment mutations on buses or drivers currently engaged in an active trip lock.
   - Manages reserve driver pools (`is_reserved=true`).
   - Requires `drivers.canReassign` permission for moderators.
3. **Bus Route Allocation Tab ([`BusRouteAllocationTab.tsx`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/components/smart-allocation/BusRouteAllocationTab.tsx)):**
   - Allocates vehicles to transit route corridors and updates stop sequences.
   - Monitors live morning and evening enrollment capacity usage.
   - Requires `buses.canReassign` permission for moderators.

### 5.2 Legacy Route Redirection
To eliminate route duplication and streamline administrative navigation:
- Navigating to `/admin/driver-assignment` automatically issues a Next.js server-side redirect to `/admin/smart-allocation?tab=drivers`.
- Navigating to `/admin/route-allocation` automatically issues a Next.js server-side redirect to `/admin/smart-allocation?tab=buses`.
- Deep-linking via query parameters (`?tab=students`, `?tab=drivers`, `?tab=buses`) ensures external links and bookmarks seamlessly activate the corresponding operational view.
