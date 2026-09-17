/**
 * e2e/gps/waiting-flag-abuse.spec.ts
 *
 * Forensic verification of waiting-flag trust, abuse resistance,
 * geofence boundaries, concurrent spam, and bus assignment validation.
 */

import { test, expect } from '@playwright/test';
import { loadPersonas, mintIdToken, apiCall, supabase, sleep } from '../helpers';
import { DriverAgent } from '../../scripts/staging/agents';

test.describe('Waiting Flag Trust & Abuse Audit', () => {
  let driverToken: string;
  let studentToken: string;
  let otherStudentToken: string;
  let driverUid: string;
  let studentUid: string;
  let otherStudentUid: string;
  let busId: string;
  let routeId: string;
  let driverAgent: DriverAgent;

  test.beforeAll(async () => {
    const personas = loadPersonas();
    if (!personas || !personas.drivers.length || personas.students.length < 2) {
      throw new Error('Staging personas missing');
    }

    const dp = personas.drivers[0];
    driverUid = dp.uid;
    busId = dp.busId!;
    routeId = dp.routeId!;

    // Find student assigned to this bus
    const sp = personas.students.find(s => s.busId === busId) || personas.students[0];
    studentUid = sp.uid;

    // Find student assigned to a different bus
    const otherSp = personas.students.find(s => s.busId !== busId) || personas.students[1];
    otherStudentUid = otherSp.uid;

    driverToken = await mintIdToken(driverUid);
    studentToken = await mintIdToken(studentUid);
    otherStudentToken = await mintIdToken(otherStudentUid);

    // Ensure bus has an active trip
    driverAgent = new DriverAgent({
      label: dp.label,
      uid: driverUid,
      idToken: driverToken,
      busId,
      routeId,
      gpsSeed: 'waiting-flag-test',
    });
    await driverAgent.startTrip();
    console.log(`[WAITING-FLAG-SETUP] Started trip for bus ${busId}`);
  });

  test.afterAll(async () => {
    // Clean up waiting flags and trip
    if (busId) {
      await supabase().from('waiting_flags').delete().eq('bus_id', busId);
    }
    if (driverAgent) {
      await driverAgent.endTrip().catch(() => { });
    }
  });

  test('Abuse Test 1 — Student assigned to a DIFFERENT bus is rejected (403 Forbidden)', async () => {
    const res = await apiCall('POST', '/api/student/waiting-flag', otherStudentToken, {
      busId, // Assigned bus of driver 1, but other student belongs to different bus
      routeId,
      stop_name: 'Paltan Bazaar',
      lat: 26.1445,
      lng: 91.7362,
    });

    expect(res.status).toBe(403);
    expect(res.json.error).toMatch(/Forbidden.*not assigned/i);
  });

  test('Abuse Test 2 — Concurrency / Spam Race: 5 concurrent requests from same student result in at most 1 active flag', async () => {
    // Clean any prior flags first
    await supabase().from('waiting_flags').delete().eq('student_uid', studentUid);

    const promises = Array.from({ length: 5 }).map((_, idx) =>
      apiCall('POST', '/api/student/waiting-flag', studentToken, {
        busId,
        routeId,
        stop_name: 'Ulubari',
        lat: 26.1512,
        lng: 91.7485,
        message: `Spam attempt ${idx}`,
      })
    );

    const results = await Promise.all(promises);
    const successes = results.filter(r => r.status === 200);
    const conflicts = results.filter(r => r.status === 409);

    console.log(`Concurrent spam results: 200 OK: ${successes.length}, 409 Conflict: ${conflicts.length}`);

    // Business invariant: exactly 1 active flag
    expect(successes.length).toBe(1);
    expect(conflicts.length).toBe(4);

    // Verify in database: exactly 1 row in waiting_flags for this student
    const { data: dbFlags } = await supabase()
      .from('waiting_flags')
      .select('id')
      .eq('student_uid', studentUid)
      .in('status', ['raised', 'acknowledged']);

    expect(dbFlags).toHaveLength(1);
  });

  test('Abuse Test 3 — Remote Location Trust Audit: System accepts flag even if student coordinates are 50 km away', async () => {
    // Clean prior flag
    await supabase().from('waiting_flags').delete().eq('student_uid', studentUid);

    // Coordinate 50 km away in Shillong / Meghalaya border (25.75, 91.85)
    const remoteLat = 25.7500;
    const remoteLng = 91.8500;

    const res = await apiCall('POST', '/api/student/waiting-flag', studentToken, {
      busId,
      routeId,
      stop_name: 'Dispur Super Market',
      lat: remoteLat,
      lng: remoteLng,
    });

    // FORENSIC OBSERVATION: Current system lacks geofence validation against stop coordinates,
    // so it succeeds (200 OK) with the student's claimed remote coordinates!
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);

    const flagId = res.json.flagId;
    const { data: flagRow } = await supabase()
      .from('waiting_flags')
      .select('stop_lat, stop_lng, status')
      .eq('id', flagId)
      .single();

    expect(flagRow?.stop_lat).toBe(remoteLat);
    expect(flagRow?.stop_lng).toBe(remoteLng);
  });

  test('Cancellation — Student can cancel active waiting flag', async () => {
    // Find active flag
    const { data: existing } = await supabase()
      .from('waiting_flags')
      .select('id')
      .eq('student_uid', studentUid)
      .eq('status', 'raised')
      .single();

    expect(existing).not.toBeNull();

    const res = await apiCall('DELETE', '/api/student/waiting-flag', studentToken, {
      flagId: existing!.id,
      busId,
    });

    expect(res.status).toBe(200);

    // Verify status changed to cancelled in database
    const { data: updated } = await supabase()
      .from('waiting_flags')
      .select('status')
      .eq('id', existing!.id)
      .single();

    expect(updated?.status).toBe('cancelled');
  });
});
