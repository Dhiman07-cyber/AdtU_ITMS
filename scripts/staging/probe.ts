/**
 * READ-ONLY probe of the staging/infra state. Writes nothing.
 * Run: npx tsx scripts/staging/probe.ts
 */
import { supabase, WS_BASE, APP_URL } from './lib';

async function count(table: string, filter?: (q: any) => any): Promise<number | string> {
  try {
    let q: any = supabase().from(table).select('*', { count: 'exact', head: true });
    if (filter) q = filter(q);
    const { count, error } = await q;
    if (error) return `ERR: ${error.message}`;
    return count ?? 0;
  } catch (e: any) { return `ERR: ${e.message}`; }
}

async function main() {
  console.log('== ITMS staging probe (read-only) ==\n');
  console.log(`APP_URL=${APP_URL}  WS_BASE=${WS_BASE}\n`);

  console.log('-- table counts --');
  for (const t of ['users', 'student_profiles', 'driver_profiles', 'buses', 'routes', 'active_trips', 'bus_locations', 'waiting_flags', 'payments']) {
    console.log(`  ${t}: ${await count(t)}`);
  }

  console.log('\n-- users by role --');
  for (const r of ['student', 'driver', 'moderator', 'admin']) {
    console.log(`  ${r}: ${await count('users', (q: any) => q.eq('role', r))}`);
  }

  console.log('\n-- existing staging namespace (itms-staging.local) --');
  console.log(`  users: ${await count('users', (q: any) => q.like('email', '%@itms-staging.local'))}`);
  console.log(`  buses: ${await count('buses', (q: any) => q.like('id', 'STAGING-%'))}`);
  console.log(`  routes: ${await count('routes', (q: any) => q.like('id', 'STAGING-%'))}`);

  console.log('\n-- sample routes (geometry source) --');
  const { data: routes } = await supabase().from('routes').select('id, route_name, stops, status').limit(10);
  for (const r of routes || []) {
    const stops = Array.isArray(r.stops) ? r.stops : [];
    const withCoords = stops.filter((s: any) => s && (s.lat || s.latitude) && (s.lng || s.longitude));
    console.log(`  ${r.id} "${r.route_name}" status=${r.status} stops=${stops.length} withCoords=${withCoords.length}`);
    if (withCoords.length) {
      const s: any = withCoords[0];
      console.log(`    first stop keys: ${Object.keys(s).join(',')}`);
      console.log(`    sample: lat=${s.lat ?? s.latitude} lng=${s.lng ?? s.longitude}`);
    }
  }

  console.log('\n-- sample buses --');
  const { data: buses } = await supabase().from('buses').select('id, bus_number, route_id, status, capacity').limit(10);
  for (const b of buses || []) console.log(`  ${b.id} "${b.bus_number}" route=${b.route_id} status=${b.status} cap=${b.capacity}`);

  console.log('\n-- live state --');
  const { data: trips } = await supabase().from('active_trips').select('trip_id, bus_id, driver_id, shift, status, start_time').limit(10);
  console.log(`  active_trips rows: ${(trips || []).length}`);
  for (const t of trips || []) console.log(`    ${t.trip_id} bus=${t.bus_id} driver=${t.driver_id} shift=${t.shift} started=${t.start_time}`);

  console.log('\n-- infra reachability --');
  try {
    const r = await fetch(`${APP_URL}/api/health?liveness=1`, { signal: AbortSignal.timeout(4000) });
    console.log(`  Next.js ${APP_URL}/api/health?liveness=1 -> ${r.status}`);
  } catch (e: any) { console.log(`  Next.js: DOWN (${e.message})`); }
  const wsHealth = (process.env.STAGING_WS_HEALTH || 'http://localhost:' + (process.env.HEALTH_PORT || 9090));
  try {
    const r = await fetch(`${wsHealth}/health/live`, { signal: AbortSignal.timeout(3000) });
    console.log(`  WS health ${wsHealth} -> ${r.status}`);
    if (r.ok) {
      const m = await fetch(`${wsHealth}/metrics`, { signal: AbortSignal.timeout(3000) });
      const text = await m.text();
      const interesting = text.split('\n').filter((l) => /^(itms_ws_connections_active|itms_gps_accepted|itms_ws_auth_successes|itms_ws_messages_(sent|received)) /.test(l));
      console.log('  WS metrics sample:');
      for (const l of interesting) console.log(`    ${l}`);
    }
  } catch (e: any) { console.log(`  WS health: DOWN (${e.message})`); }
  try {
    const { execSync } = require('child_process');
    console.log(`  git: ${execSync('git rev-parse --short HEAD').toString().trim()} (${execSync('git branch --show-current').toString().trim()})`);
  } catch { /* ignore */ }
}

main().then(() => process.exit(0)).catch((e) => { console.error('PROBE FAILED:', e); process.exit(1); });
