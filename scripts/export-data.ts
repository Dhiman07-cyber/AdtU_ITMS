import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

const ROOT = path.join(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env.local') });
dotenv.config({ path: path.join(ROOT, '.env') });

const OLD_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const OLD_SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!OLD_SUPABASE_URL || !OLD_SUPABASE_KEY) {
  throw new Error('Missing old Supabase URL or SERVICE_ROLE_KEY in .env');
}

const sb = createClient(OLD_SUPABASE_URL, OLD_SUPABASE_KEY, {
  auth: { persistSession: false }
});

// Load personas to skip
const personasPath = path.join(ROOT, 'scripts', 'staging', '.personas.json');
let stagingUids = new Set<string>();
let stagingBuses = new Set<string>();
let stagingRoutes = new Set<string>();

if (fs.existsSync(personasPath)) {
  const personas = JSON.parse(fs.readFileSync(personasPath, 'utf8'));
  (personas.drivers || []).forEach((d: any) => stagingUids.add(d.uid));
  (personas.students || []).forEach((s: any) => stagingUids.add(s.uid));
  (personas.buses || []).forEach((b: any) => stagingBuses.add(b.id));
  (personas.routes || []).forEach((r: any) => stagingRoutes.add(r.id));
}

console.log(`Loaded staging filters: ${stagingUids.size} UIDs, ${stagingBuses.size} Buses, ${stagingRoutes.size} Routes`);

const DATA_DIR = path.join(ROOT, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Fetch helper with pagination
async function fetchAll(table: string): Promise<any[]> {
  const all: any[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await sb.from(table).select('*').range(from, from + pageSize - 1);
    if (error) {
      console.warn(`[WARN] Table ${table} fetch error: ${error.message}`);
      return [];
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

// SQL literal escaping helper
function toSqlLiteral(val: any): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'object') {
    const json = JSON.stringify(val).replace(/'/g, "''");
    return `'${json}'::jsonb`;
  }
  const str = String(val).replace(/'/g, "''");
  return `'${str}'`;
}

// Generate INSERT SQL
function generateInsertSql(table: string, rows: any[], primaryKeys: string[] = ['id']): string {
  if (!rows || rows.length === 0) return `-- No rows for ${table}\n`;
  const columns = Object.keys(rows[0]);
  const lines: string[] = [];
  lines.push(`-- Table: ${table} (${rows.length} rows)`);

  for (const row of rows) {
    const colList = columns.map(c => `"${c}"`).join(', ');
    const valList = columns.map(c => toSqlLiteral(row[c])).join(', ');
    const conflictCols = primaryKeys.map(k => `"${k}"`).join(', ');
    const updateClauses = columns
      .filter(c => !primaryKeys.includes(c))
      .map(c => `"${c}" = EXCLUDED."${c}"`)
      .join(', ');

    if (updateClauses.length > 0) {
      lines.push(`INSERT INTO public."${table}" (${colList}) VALUES (${valList}) ON CONFLICT (${conflictCols}) DO UPDATE SET ${updateClauses};`);
    } else {
      lines.push(`INSERT INTO public."${table}" (${colList}) VALUES (${valList}) ON CONFLICT (${conflictCols}) DO NOTHING;`);
    }
  }
  return lines.join('\n') + '\n\n';
}

async function exportData() {
  console.log('🚀 Starting Data Extraction from Old Supabase (ztqilqooygdqpmhnxidi)...');
  const summary: Record<string, { total: number; exported: number; skippedStaging: number }> = {};
  const seedSqlParts: string[] = [
    '-- =============================================================================',
    '-- ADTU ITMS Authoritative Production Seed Data',
    `-- Exported At: ${new Date().toISOString()}`,
    '-- Source: Supabase ztqilqooygdqpmhnxidi (RLS-bypassed Service Role)',
    '-- Filter: Excluded all staging / fake personas from scripts/staging/.personas.json',
    '-- =============================================================================\n',
    'BEGIN;\n'
  ];

  // 1. users
  console.log('Fetching users...');
  const rawUsers = await fetchAll('users');
  const cleanUsers = rawUsers.filter(u => 
    !stagingUids.has(u.uid) && 
    !u.email?.endsWith('@itms-staging.local') && 
    !u.email?.includes('staging') &&
    !u.name?.startsWith('Staging ')
  );
  fs.writeFileSync(path.join(DATA_DIR, 'users.json'), JSON.stringify(cleanUsers, null, 2));
  summary['users'] = { total: rawUsers.length, exported: cleanUsers.length, skippedStaging: rawUsers.length - cleanUsers.length };
  seedSqlParts.push(generateInsertSql('users', cleanUsers, ['uid']));

  // 2. admin_profiles
  console.log('Fetching admin_profiles...');
  const rawAdmin = await fetchAll('admin_profiles');
  const cleanAdmin = rawAdmin.filter(a => !stagingUids.has(a.uid) && !a.email?.includes('staging'));
  fs.writeFileSync(path.join(DATA_DIR, 'admin_profiles.json'), JSON.stringify(cleanAdmin, null, 2));
  summary['admin_profiles'] = { total: rawAdmin.length, exported: cleanAdmin.length, skippedStaging: rawAdmin.length - cleanAdmin.length };
  seedSqlParts.push(generateInsertSql('admin_profiles', cleanAdmin, ['uid']));

  // 3. moderator_profiles
  console.log('Fetching moderator_profiles...');
  const rawMod = await fetchAll('moderator_profiles');
  const cleanMod = rawMod.filter(m => !stagingUids.has(m.uid) && !m.email?.includes('staging'));
  fs.writeFileSync(path.join(DATA_DIR, 'moderator_profiles.json'), JSON.stringify(cleanMod, null, 2));
  summary['moderator_profiles'] = { total: rawMod.length, exported: cleanMod.length, skippedStaging: rawMod.length - cleanMod.length };
  seedSqlParts.push(generateInsertSql('moderator_profiles', cleanMod, ['uid']));

  // 4. unauth_users
  console.log('Fetching unauth_users...');
  const rawUnauth = await fetchAll('unauth_users');
  const cleanUnauth = rawUnauth.filter(u => !stagingUids.has(u.uid) && !u.email?.includes('staging'));
  fs.writeFileSync(path.join(DATA_DIR, 'unauth_users.json'), JSON.stringify(cleanUnauth, null, 2));
  summary['unauth_users'] = { total: rawUnauth.length, exported: cleanUnauth.length, skippedStaging: rawUnauth.length - cleanUnauth.length };
  seedSqlParts.push(generateInsertSql('unauth_users', cleanUnauth, ['uid']));

  // 5. routes
  console.log('Fetching routes...');
  const rawRoutes = await fetchAll('routes');
  const cleanRoutes = rawRoutes.filter(r => !stagingRoutes.has(r.id) && !r.id.startsWith('STAGING-'));
  fs.writeFileSync(path.join(DATA_DIR, 'routes.json'), JSON.stringify(cleanRoutes, null, 2));
  summary['routes'] = { total: rawRoutes.length, exported: cleanRoutes.length, skippedStaging: rawRoutes.length - cleanRoutes.length };
  seedSqlParts.push(generateInsertSql('routes', cleanRoutes, ['id']));

  // 6. buses
  console.log('Fetching buses...');
  const rawBuses = await fetchAll('buses');
  const cleanBuses = rawBuses.filter(b => !stagingBuses.has(b.id) && !b.id.startsWith('STAGING-'));
  fs.writeFileSync(path.join(DATA_DIR, 'buses.json'), JSON.stringify(cleanBuses, null, 2));
  summary['buses'] = { total: rawBuses.length, exported: cleanBuses.length, skippedStaging: rawBuses.length - cleanBuses.length };
  seedSqlParts.push(generateInsertSql('buses', cleanBuses, ['id']));

  // 7. driver_profiles
  console.log('Fetching driver_profiles...');
  const rawDrivers = await fetchAll('driver_profiles');
  const cleanDrivers = rawDrivers.filter(d => !stagingUids.has(d.uid) && !d.email?.includes('@itms-staging.local'));
  fs.writeFileSync(path.join(DATA_DIR, 'driver_profiles.json'), JSON.stringify(cleanDrivers, null, 2));
  summary['driver_profiles'] = { total: rawDrivers.length, exported: cleanDrivers.length, skippedStaging: rawDrivers.length - cleanDrivers.length };
  seedSqlParts.push(generateInsertSql('driver_profiles', cleanDrivers, ['uid']));

  // 8. student_profiles
  console.log('Fetching student_profiles...');
  const rawStudents = await fetchAll('student_profiles');
  const cleanStudents = rawStudents.filter(s => !stagingUids.has(s.uid) && !s.email?.includes('@itms-staging.local'));
  fs.writeFileSync(path.join(DATA_DIR, 'student_profiles.json'), JSON.stringify(cleanStudents, null, 2));
  summary['student_profiles'] = { total: rawStudents.length, exported: cleanStudents.length, skippedStaging: rawStudents.length - cleanStudents.length };
  seedSqlParts.push(generateInsertSql('student_profiles', cleanStudents, ['uid']));

  // 9. payments
  console.log('Fetching payments...');
  const rawPayments = await fetchAll('payments');
  // Distinct real student payments vs test fixtures
  const cleanPayments = rawPayments.filter(p => {
    if (stagingUids.has(p.student_uid)) return false;
    if (p.student_uid === 'test_uid') return false;
    if (p.student_name && p.student_name.includes('Verification Student')) return false;
    if (p.student_name && p.student_name.includes('Concurrent Race')) return false;
    return true;
  });
  fs.writeFileSync(path.join(DATA_DIR, 'payments.json'), JSON.stringify(cleanPayments, null, 2));
  fs.writeFileSync(path.join(DATA_DIR, 'payments_all_fixtures.json'), JSON.stringify(rawPayments, null, 2));
  summary['payments'] = { total: rawPayments.length, exported: cleanPayments.length, skippedStaging: rawPayments.length - cleanPayments.length };
  seedSqlParts.push(generateInsertSql('payments', cleanPayments, ['id']));

  // 10. waiting_flags
  console.log('Fetching waiting_flags...');
  const rawWf = await fetchAll('waiting_flags');
  const cleanWf = rawWf.filter(w => !stagingUids.has(w.student_uid) && !stagingBuses.has(w.bus_id) && !stagingRoutes.has(w.route_id));
  fs.writeFileSync(path.join(DATA_DIR, 'waiting_flags.json'), JSON.stringify(cleanWf, null, 2));
  summary['waiting_flags'] = { total: rawWf.length, exported: cleanWf.length, skippedStaging: rawWf.length - cleanWf.length };
  seedSqlParts.push(generateInsertSql('waiting_flags', cleanWf, ['id']));

  // 11. driver_trip_history
  console.log('Fetching driver_trip_history...');
  const rawDth = await fetchAll('driver_trip_history');
  const cleanDth = rawDth.filter(h => 
    !stagingUids.has(h.driver_id) && 
    !stagingBuses.has(h.bus_id) && 
    !stagingRoutes.has(h.route_id) &&
    !h.bus_id?.startsWith('STAGING-') &&
    !h.route_id?.startsWith('STAGING-')
  );
  fs.writeFileSync(path.join(DATA_DIR, 'driver_trip_history.json'), JSON.stringify(cleanDth, null, 2));
  summary['driver_trip_history'] = { total: rawDth.length, exported: cleanDth.length, skippedStaging: rawDth.length - cleanDth.length };
  seedSqlParts.push(generateInsertSql('driver_trip_history', cleanDth, ['id']));

  // 12. audit_events
  console.log('Fetching audit_events...');
  const rawAudits = await fetchAll('audit_events');
  const cleanAudits = rawAudits.filter(a => {
    if (stagingUids.has(a.actor_id)) return false;
    if (a.target_id && (stagingUids.has(a.target_id) || stagingBuses.has(a.target_id) || stagingRoutes.has(a.target_id))) return false;
    if (a.summary && a.summary.includes('STAGING')) return false;
    if (a.actor_email && a.actor_email.includes('@itms-staging.local')) return false;
    return true;
  });
  fs.writeFileSync(path.join(DATA_DIR, 'audit_events.json'), JSON.stringify(cleanAudits, null, 2));
  summary['audit_events'] = { total: rawAudits.length, exported: cleanAudits.length, skippedStaging: rawAudits.length - cleanAudits.length };
  seedSqlParts.push(generateInsertSql('audit_events', cleanAudits, ['id']));

  // 13. reassignment_logs
  console.log('Fetching reassignment_logs...');
  const rawReassigns = await fetchAll('reassignment_logs');
  const cleanReassigns = rawReassigns.filter(r => !stagingBuses.has(r.bus_id) && !stagingRoutes.has(r.route_id) && !stagingUids.has(r.driver_id));
  fs.writeFileSync(path.join(DATA_DIR, 'reassignment_logs.json'), JSON.stringify(cleanReassigns, null, 2));
  summary['reassignment_logs'] = { total: rawReassigns.length, exported: cleanReassigns.length, skippedStaging: rawReassigns.length - cleanReassigns.length };
  seedSqlParts.push(generateInsertSql('reassignment_logs', cleanReassigns, ['id']));

  // 14. fcm_tokens
  console.log('Fetching fcm_tokens...');
  const rawFcm = await fetchAll('fcm_tokens');
  const cleanFcm = rawFcm.filter(f => !stagingUids.has(f.user_id));
  fs.writeFileSync(path.join(DATA_DIR, 'fcm_tokens.json'), JSON.stringify(cleanFcm, null, 2));
  summary['fcm_tokens'] = { total: rawFcm.length, exported: cleanFcm.length, skippedStaging: rawFcm.length - cleanFcm.length };
  seedSqlParts.push(generateInsertSql('fcm_tokens', cleanFcm, ['id']));

  // 15. notifications
  console.log('Fetching notifications...');
  const rawNotifs = await fetchAll('notifications');
  const cleanNotifs = rawNotifs.filter(n => !stagingUids.has(n.sender_user_id));
  fs.writeFileSync(path.join(DATA_DIR, 'notifications.json'), JSON.stringify(cleanNotifs, null, 2));
  summary['notifications'] = { total: rawNotifs.length, exported: cleanNotifs.length, skippedStaging: rawNotifs.length - cleanNotifs.length };
  seedSqlParts.push(generateInsertSql('notifications', cleanNotifs, ['id']));

  // 16. Empty domain tables
  const emptyTables = [
    'applications',
    'temporary_assignments',
    'active_trips',
    'processed_payments',
    'processed_operations',
    'driver_location_updates',
    'device_sessions'
  ];

  for (const t of emptyTables) {
    const raw = await fetchAll(t);
    fs.writeFileSync(path.join(DATA_DIR, `${t}.json`), JSON.stringify(raw, null, 2));
    summary[t] = { total: raw.length, exported: raw.length, skippedStaging: 0 };
  }

  seedSqlParts.push('COMMIT;\n');
  fs.writeFileSync(path.join(DATA_DIR, 'seed.sql'), seedSqlParts.join('\n'));

  // Write Manifest
  const manifest = {
    exportedAt: new Date().toISOString(),
    sourceProject: OLD_SUPABASE_URL,
    totalTables: Object.keys(summary).length,
    summary,
    notes: 'Excludes all staging personas matching .personas.json and @itms-staging.local'
  };
  fs.writeFileSync(path.join(DATA_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log('\n================ EXPORT SUMMARY ================');
  console.table(summary);
  console.log(`\n✅ Data exported to directory: ${DATA_DIR}`);
  console.log(`✅ Seed SQL script written to: ${path.join(DATA_DIR, 'seed.sql')}`);
  console.log(`✅ Manifest written to: ${path.join(DATA_DIR, 'manifest.json')}`);
}

exportData().catch(console.error);
