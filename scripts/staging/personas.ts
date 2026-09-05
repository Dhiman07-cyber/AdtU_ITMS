/**
 * Deterministic staging personas.
 *
 *   npx tsx scripts/staging/personas.ts --drivers 5 --students 25     (seed / top-up)
 *   npx tsx scripts/staging/personas.ts --cleanup                     (remove everything)
 *
 * Creates real Firebase Auth users + real Supabase rows, all under the
 * `itms-staging.local` email domain and `STAGING-*` entity ids, so a cleanup
 * is unambiguous and no real user data is ever touched.
 *
 * Buses point at STAGING-ROUTE-* (stop names cloned from a real route) rather
 * than real routes ON PURPOSE: trip-start awaits an FCM fanout to
 * route_{ routeId } subscribers, and pointing staging trips at real routes
 * would push real users' devices.
 */
import { firebaseAdmin, supabase, savePersonas, loadPersonas, type PersonaSet, type Persona } from './lib';

const DOMAIN = 'itms-staging.local';
const pad = (n: number) => String(n).padStart(3, '0');
const driverEmail = (n: number) => `staging-driver-${pad(n)}@${DOMAIN}`;
const studentEmail = (n: number) => `staging-student-${pad(n)}@${DOMAIN}`;
const BUS_ID = (n: number) => `STAGING-BUS-${pad(n)}`;
const ROUTE_ID = (n: number) => `STAGING-ROUTE-${pad(n)}`;

async function ensureAuthUser(email: string, displayName: string): Promise<string> {
  const auth = firebaseAdmin();
  try {
    return (await auth.getUserByEmail(email)).uid;
  } catch (e: any) {
    if (e?.code !== 'auth/user-not-found') throw e;
    return (await auth.createUser({ email, emailVerified: true, displayName })).uid;
  }
}

async function seed(opts: { drivers: number; students: number }) {
  const sb = supabase();
  const namePool = (await sb.from('routes').select('id, stops').eq('id', 'route_1').single()).data?.stops
    ?.map((s: any) => s.name) ?? ['AdtU Campus', 'Garchuk', 'Boragaon'];

  const buses: PersonaSet['buses'] = [];
  const routes: PersonaSet['routes'] = [];
  const drivers: Persona[] = [];
  const students: Persona[] = [];

  // One staging route + bus per driver, so N buses can be on active trips
  // simultaneously without trip-lock conflicts.
  for (let i = 1; i <= opts.drivers; i++) {
    const routeId = ROUTE_ID(i);
    const busId = BUS_ID(i);

    const { error: rErr } = await sb.from('routes').upsert({
      id: routeId, route_name: `Staging Route ${pad(i)}`, stops: namePool, status: 'active',
    }, { onConflict: 'id' });
    if (rErr) throw new Error(`route ${routeId}: ${rErr.message}`);
    routes.push({ id: routeId });

    const { error: bErr } = await sb.from('buses').upsert({
      id: busId, bus_number: `STG-${pad(i)}`, route_id: routeId, route_name: `Staging Route ${pad(i)}`,
      status: 'active', capacity: 55,
    }, { onConflict: 'id' });
    if (bErr) throw new Error(`bus ${busId}: ${bErr.message}`);
    buses.push({ id: busId, routeId });

    const uid = await ensureAuthUser(driverEmail(i), `Staging Driver ${pad(i)}`);
    const now = new Date().toISOString();
    const { error: uErr } = await sb.from('users').upsert({
      uid, email: driverEmail(i), name: `Staging Driver ${pad(i)}`, role: 'driver', updated_at: now,
    }, { onConflict: 'uid' });
    if (uErr) throw new Error(`driver users row ${uid}: ${uErr.message}`);
    const { error: dErr } = await sb.from('driver_profiles').upsert({
      uid, email: driverEmail(i), full_name: `Staging Driver ${pad(i)}`, employee_id: `STG-DRV-${pad(i)}`,
      bus_id: busId, status: 'active', shift: 'Morning', updated_at: now,
    }, { onConflict: 'uid' });
    if (dErr) throw new Error(`driver_profile ${uid}: ${dErr.message}`);
    drivers.push({ label: `DRIVER-${pad(i)}`, role: 'driver', uid, email: driverEmail(i), busId, routeId });
    console.log(`driver ${pad(i)} ready (bus=${busId}, route=${routeId})`);
  }

  // Students, assigned round-robin across staging buses.
  const validUntil = new Date(Date.now() + 400 * 24 * 3600 * 1000).toISOString();
  for (let i = 1; i <= opts.students; i++) {
    const bus = buses[(i - 1) % buses.length];
    const uid = await ensureAuthUser(studentEmail(i), `Staging Student ${pad(i)}`);
    const now = new Date().toISOString();
    const { error: uErr } = await sb.from('users').upsert({
      uid, email: studentEmail(i), name: `Staging Student ${pad(i)}`, role: 'student', updated_at: now,
    }, { onConflict: 'uid' });
    if (uErr) throw new Error(`student users row ${uid}: ${uErr.message}`);
    const { error: sErr } = await sb.from('student_profiles').upsert({
      uid, email: studentEmail(i), full_name: `Staging Student ${pad(i)}`,
      enrollment_id: `STG-STU-${pad(i)}`, bus_id: bus.id, route_id: bus.routeId,
      stop_name: namePool[0], shift: 'Morning', status: 'active',
      faculty: 'STAGING', department: 'STAGING',
      valid_until: validUntil, session_start_year: new Date().getFullYear(), session_end_year: new Date().getFullYear() + 1,
      updated_at: now,
    }, { onConflict: 'uid' });
    if (sErr) throw new Error(`student_profile ${uid}: ${sErr.message}`);
    students.push({ label: `STUDENT-${pad(i)}`, role: 'student', uid, email: studentEmail(i), busId: bus.id, routeId: bus.routeId });
    if (i % 25 === 0 || i === opts.students) console.log(`students: ${i}/${opts.students}`);
  }

  savePersonas({ createdAt: new Date().toISOString(), drivers, students, buses, routes });
  console.log(`\nSEEDED: ${drivers.length} drivers, ${students.length} students, ${buses.length} buses/routes (STAGING-*)`);
}

async function cleanup() {
  const existing = loadPersonas();
  const sb = supabase();
  const auth = firebaseAdmin();

  // Runtime evidence created by runs
  const busIds = (existing?.buses || []).map((b) => b.id);
  if (busIds.length) {
    await sb.from('waiting_flags').delete().in('bus_id', busIds);
    await sb.from('active_trips').delete().in('bus_id', busIds);
    await sb.from('bus_locations').delete().in('bus_id', busIds);
    await sb.from('buses').delete().in('id', busIds);
    await sb.from('routes').delete().in('id', (existing?.routes || []).map((r) => r.id));
  }

  const emails = [...(existing?.drivers || []), ...(existing?.students || [])].map((p) => p.email);
  const uids = (existing && emails.length)
    ? (existing.drivers.concat(existing.students).map((p) => p.uid))
    : [];
  // Fallback: find anything with the staging domain (covers partial seed failures)
  if (!uids.length) {
    const { data } = await sb.from('users').select('uid').like('email', `%@${DOMAIN}`);
    if (data) uids.push(...data.map((r: any) => r.uid));
  }
  if (uids.length) {
    await sb.from('student_profiles').delete().in('uid', uids);
    await sb.from('driver_profiles').delete().in('uid', uids);
    await sb.from('users').delete().in('uid', uids);
    for (const uid of uids) {
      try { await auth.deleteUser(uid); } catch { /* already gone */ }
    }
  }
  console.log(`CLEANED: ${uids.length} auth users + Supabase rows, ${busIds.length} staging buses/routes`);
}

const args = process.argv.slice(2);
const num = (flag: string, dflt: number) => {
  const i = args.indexOf(flag);
  return i >= 0 ? Number(args[i + 1]) || dflt : dflt;
};

if (args.includes('--cleanup')) {
  cleanup().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
} else {
  seed({ drivers: num('--drivers', 5), students: num('--students', 25) })
    .then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
