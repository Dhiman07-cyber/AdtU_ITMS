# Fleet, Route & Driver Operations: Active-Trip Mutation Guards & Cascading Cleanup (Forensic Truth)

**Module:** Bus/Driver/Route CRUD, In-Flight Trip Mutation Rejection, Driver Phone Verification & Stale Session Reaper  
**File Authority:** `src/app/api/fleet/`, `src/app/api/routes/`, `src/lib/services/bus-runtime-state.ts`  
**Database Triggers & Procedures:** `prevent_active_trip_route_change`, `prevent_active_trip_bus_delete`  

---

# PART 9: Fleet, Route & Driver CRUD Operations, Active-Trip Mutation Guards & Cascading Cleanup

### 9.1 Sub-Domain Architecture & Exact Execution Pipeline

Deleting infrastructure entities (Buses, Routes, Users) can compromise live operations. ADTU ITMS enforces pre-flight mutation guards:
1. **Mid-Trip Mutation Guard (`INV-FLEET-001`):** A bus or driver participating in an active trip cannot be modified, reassigned, or deleted. The operation is aborted with HTTP 409.
2. **Active Student Seat Guard (`INV-FLEET-002`):** A bus cannot be deleted if active seat-holding students are assigned to it.
3. **Cascading Cleanup Transaction:** Deletions execute within atomic PostgreSQL transactions (`delete_student_cascade_v1`, `delete_route_cascade_v1`), followed by Firebase Auth deletion, Cloudinary image pruning, and FCM token removal.

---

### 9.2 Verbatim Source Code from Live Codebase

```typescript
// ============================================================================
// VERBATIM FROM src/lib/cleanup-helpers.ts
// ============================================================================

export async function deleteBusAndData(busId: string): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('Deleting bus with ID:', busId);

    // Get bus data
    const busData = await fleetService.getBusById(busId);
    if (!busData) {
      return { success: false, error: 'Bus not found' };
    }

    const db = getSupabaseServer();

    // 1. Active Trip Guard (Cannot delete bus during active trip)
    const busVariations = getBusIdVariations(busId);
    const { data: activeTrips } = await db
      .from('active_trips')
      .select('id, status')
      .in('bus_id', busVariations)
      .in('status', ['active', 'SCHEDULED', 'IN_TRANSIT', 'started', 'in_progress'])
      .gt('expires_at', new Date().toISOString())
      .limit(1);

    if (activeTrips && activeTrips.length > 0) {
      return { success: false, error: 'Cannot delete bus while an active trip is in progress. End the trip first.' };
    }

    // 2. Active Enrolled Students Guard (Cannot delete bus with active seat-holding students)
    const students = (await getStudentsByBusIds(busVariations)) || [];
    const activeStudents = students.filter(s => s.status === 'active' && !wasSeatReleased(s));
    if (activeStudents.length > 0) {
      return {
        success: false,
        error: `Cannot delete bus while ${activeStudents.length} active seat-holding student(s) are assigned to it. Reassign students first.`
      };
    }

    // 3. Clean student references for remaining inactive/seat-released students (batch update, no N+1 loops)
    try {
      const { data: updatedStudents, error: studErr } = await db
        .from('student_profiles')
        .update({
          bus_id: null,
          route_id: null,
          stop_name: null,
          updated_at: new Date().toISOString(),
        })
        .in('bus_id', busVariations)
        .select('uid');

      if (studErr) {
        console.error('Error clearing student bus assignments in PostgreSQL:', studErr);
      }

      const affectedStudentUids = new Set<string>([
        ...students.map((s) => s.uid),
        ...(updatedStudents || []).map((s: { uid: string }) => s.uid),
      ]);

      for (const sUid of affectedStudentUids) {
        invalidateStudentAssignmentCache(sUid);
      }
      console.log(`Cleared busId/routeId/stop_name from ${affectedStudentUids.size} students in PostgreSQL`);
    } catch (pgStudErr) {
      console.error('Error clearing student bus assignments in PostgreSQL:', pgStudErr);
    }

    // 4. Unassign bus from drivers in PostgreSQL (batch update, no N+1 loops)
    try {
      const { data: updatedDrivers, error: driverErr } = await db
        .from('driver_profiles')
        .update({
          bus_id: null,
          updated_at: new Date().toISOString(),
        })
        .in('bus_id', busVariations)
        .select('uid');

      if (driverErr) {
        console.error('Error unassigning bus from drivers in PostgreSQL:', driverErr);
      } else {
        console.log(`Unassigned bus ${busId} from ${updatedDrivers?.length || 0} drivers in PostgreSQL`);
      }
    } catch (pgDriverErr) {
      console.error('Error unassigning bus from drivers in PostgreSQL:', pgDriverErr);
    }

    // 5. Delete bus from PostgreSQL and invalidate all caches
    try {
      await fleetService.removeBus(busId);
      for (const bVar of busVariations) {
        fleetService.invalidateBusCache(bVar);
        invalidateBusTripSnapshot(bVar);
      }
      console.log('Deleted bus from PostgreSQL:', busId);
    } catch (pgBusErr) {
      console.error('Error deleting bus from PostgreSQL:', pgBusErr);
    }

    return { success: true };
  } catch (error: any) {
    console.error('Error deleting bus:', error);
    return { success: false, error: error.message };
  }
}
```

```typescript
// ============================================================================
// VERBATIM FROM src/app/api/fleet/force-end-trip/route.ts (Driver Exclusivity Gate)
// ============================================================================

export const POST = withSecurity(
  async (_request, { auth }) => {
    // External force-ending of trips has been deprecated and disabled.
    // In accordance with transit safety invariants, only the assigned driver
    // may conclude their trip. Unresponsive trips are automatically reaped by
    // the system heartbeat and TTL mechanisms.
    return NextResponse.json(
      {
        success: false,
        error: 'External force-end trip is disabled. Only the assigned driver may conclude an active trip, or stale locks are reaped via heartbeat expiry.',
      },
      { status: 403 }
    );
  },
  {
    requiredRoles: ['admin', 'moderator'],
    rateLimit: RateLimits.MUTATION,
  }
);
```

---

