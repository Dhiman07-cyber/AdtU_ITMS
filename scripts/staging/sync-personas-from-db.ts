import { supabase, savePersonas, type PersonaSet, type Persona } from './lib';

async function sync() {
  console.log('🔄 Syncing personas from Supabase...');
  const sb = supabase();

  // 1. Fetch buses
  const { data: busesData, error: bErr } = await sb
    .from('buses')
    .select('id, route_id')
    .like('id', 'STAGING-%')
    .order('id', { ascending: true });
  if (bErr) throw new Error(`Failed to fetch buses: ${bErr.message}`);

  // 2. Fetch routes
  const { data: routesData, error: rErr } = await sb
    .from('routes')
    .select('id')
    .like('id', 'STAGING-%')
    .order('id', { ascending: true });
  if (rErr) throw new Error(`Failed to fetch routes: ${rErr.message}`);

  // 3. Fetch drivers (deduplicated by email)
  const { data: driversData, error: dErr } = await sb
    .from('driver_profiles')
    .select('uid, email, bus_id')
    .like('email', '%@itms-staging.local')
    .order('email', { ascending: true });
  if (dErr) throw new Error(`Failed to fetch drivers: ${dErr.message}`);

  const busRouteMap = new Map((busesData || []).map(b => [b.id, b.route_id]));

  const seenDriverEmails = new Set<string>();
  const drivers: Persona[] = [];
  for (const d of (driversData || [])) {
    if (seenDriverEmails.has(d.email)) continue;
    seenDriverEmails.add(d.email);
    const busId = d.bus_id || 'STAGING-BUS-001';
    const routeId = busRouteMap.get(busId) || 'STAGING-ROUTE-001';
    const numStr = d.email.match(/\d+/)?.[0] || String(drivers.length + 1).padStart(3, '0');
    drivers.push({
      label: `DRIVER-${numStr}`,
      role: 'driver',
      uid: d.uid,
      email: d.email,
      busId,
      routeId
    });
  }

  // 4. Fetch students (all 2000, paginated if needed)
  const students: Persona[] = [];
  const seenStudentEmails = new Set<string>();
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data: studentsData, error: sErr } = await sb
      .from('student_profiles')
      .select('uid, email, bus_id, route_id')
      .like('email', '%@itms-staging.local')
      .order('email', { ascending: true })
      .range(from, from + pageSize - 1);

    if (sErr) throw new Error(`Failed to fetch students: ${sErr.message}`);
    if (!studentsData || studentsData.length === 0) break;

    for (const s of studentsData) {
      if (seenStudentEmails.has(s.email)) continue;
      seenStudentEmails.add(s.email);
      const numStr = s.email.match(/\d+/)?.[0] || String(students.length + 1).padStart(3, '0');
      students.push({
        label: `STUDENT-${numStr}`,
        role: 'student',
        uid: s.uid,
        email: s.email,
        busId: s.bus_id,
        routeId: s.route_id
      });
    }

    if (studentsData.length < pageSize) break;
    from += pageSize;
  }

  const personaSet: PersonaSet = {
    createdAt: new Date().toISOString(),
    drivers: drivers.slice(0, 50), // Cap at 50 drivers matching the 50 staging buses
    students: students.slice(0, 2000), // All 2000 students
    buses: (busesData || []).map(b => ({ id: b.id, routeId: b.route_id })),
    routes: (routesData || []).map(r => ({ id: r.id }))
  };

  savePersonas(personaSet);
  console.log(`✅ Personas synced successfully:`);
  console.log(`   - Drivers: ${personaSet.drivers.length}`);
  console.log(`   - Students: ${personaSet.students.length}`);
  console.log(`   - Buses: ${personaSet.buses.length}`);
  console.log(`   - Routes: ${personaSet.routes.length}`);
}

sync().catch(err => {
  console.error('❌ Error syncing personas:', err);
  process.exit(1);
});
