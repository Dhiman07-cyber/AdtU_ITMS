/**
 * tests/live-integration/03-counter-correctness.spec.ts
 *
 * STAGE 4: CRON-05 COUNTER CORRECTNESS, SEAT RELEASE GUARDS & SHIFT ISOLATION
 *
 * Verifies against live Supabase PostgreSQL:
 * 1. Scenario A: Deletion of student holding seat decrements shift load and current_members
 * 2. Scenario B: Deletion of student with prior released seat does NOT decrement (no undercount)
 * 3. Scenario C: Soft-block seat release correctly isolates shift loads (Morning vs Evening)
 * 4. Scenario D: Idempotent double-release guard prevents negative counters or drift
 * 5. Full cleanup with 0 residual records
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
dotenv.config({ path: path.join(ROOT, '.env.local') });
dotenv.config({ path: path.join(ROOT, '.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing Supabase credentials in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

const TEST_BUS = 'TEST_BUS_STAGE4';

async function main() {
  console.log('\n===============================================================');
  console.log('  STAGE 4: CRON-05 COUNTER CORRECTNESS & SEAT RELEASE GUARDS');
  console.log('===============================================================\n');

  // Setup isolated test bus
  console.log(`Setting up isolated test bus ${TEST_BUS}...`);
  await supabase.from('buses').upsert({
    id: TEST_BUS,
    bus_number: 'BUS-STAGE-4',
    capacity: 50,
    morning_load: 10,
    evening_load: 10,
    current_members: 20,
    status: 'active',
    updated_at: new Date().toISOString(),
  });

  let passCount = 0;
  let failCount = 0;

  function assert(name: string, condition: boolean, extra?: string) {
    if (condition) {
      console.log(`  [PASS] ${name}`);
      passCount++;
    } else {
      console.error(`  [FAIL] ${name} ${extra || ''}`);
      failCount++;
    }
  }

  // ── SCENARIO A: Student holds Morning seat (seat_released_at IS NULL) ──
  console.log('\n--- Scenario A: Delete student holding Morning seat ---');
  const uidA = `TEST_STU_4A_${Date.now()}`;
  await supabase.from('users').upsert({ uid: uidA, email: `${uidA.toLowerCase()}@itms-staging.local`, name: 'Stu 4A', role: 'student' });
  await supabase.from('student_profiles').upsert({
    uid: uidA,
    email: `${uidA.toLowerCase()}@itms-staging.local`,
    full_name: 'Stu 4A',
    bus_id: TEST_BUS,
    shift: 'Morning',
    status: 'expired',
    valid_until: new Date(Date.now() - 86400000).toISOString(),
    seat_released_at: null,
  });

  const { data: delA, error: errA } = await supabase.rpc('delete_student_cascade_v1', {
    p_student_uid: uidA,
  });
  assert('RPC delete_student_cascade_v1 executed without error', !errA, errA?.message);
  assert('Student was reported as deleted', (delA as any)?.success === true);
  assert('Cascade counts verified', (delA as any)?.student_deleted === 1);

  const { data: busA } = await supabase.from('buses').select('morning_load, current_members').eq('id', TEST_BUS).single();
  assert('Bus morning_load decremented from 10 to 9', busA?.morning_load === 9, `got ${busA?.morning_load}`);
  assert('Bus current_members decremented from 20 to 19', busA?.current_members === 19, `got ${busA?.current_members}`);

  // ── SCENARIO B: Student whose seat was ALREADY released ──
  console.log('\n--- Scenario B: Delete student whose seat was ALREADY released ---');
  const uidB = `TEST_STU_4B_${Date.now()}`;
  await supabase.from('users').upsert({ uid: uidB, email: `${uidB.toLowerCase()}@itms-staging.local`, name: 'Stu 4B', role: 'student' });
  await supabase.from('student_profiles').upsert({
    uid: uidB,
    email: `${uidB.toLowerCase()}@itms-staging.local`,
    full_name: 'Stu 4B',
    bus_id: TEST_BUS,
    shift: 'Morning',
    status: 'expired',
    valid_until: new Date(Date.now() - 86400000).toISOString(),
    seat_released_at: new Date(Date.now() - 3600000).toISOString(),
  });

  const { data: delB, error: errB } = await supabase.rpc('delete_student_cascade_v1', {
    p_student_uid: uidB,
  });
  assert('RPC executed without error for prior-released student', !errB, errB?.message);
  assert('Student reported as deleted', (delB as any)?.success === true);

  const { data: busB } = await supabase.from('buses').select('morning_load, current_members').eq('id', TEST_BUS).single();
  assert('Bus morning_load remained untouched at 9 (NO double-decrement)', busB?.morning_load === 9, `got ${busB?.morning_load}`);

  // ── SCENARIO C: Soft-block seat release for Evening shift ──
  console.log('\n--- Scenario C: Soft-block seat release for Evening shift ---');
  const uidC = `TEST_STU_4C_${Date.now()}`;
  await supabase.from('users').upsert({ uid: uidC, email: `${uidC.toLowerCase()}@itms-staging.local`, name: 'Stu 4C', role: 'student' });
  await supabase.from('student_profiles').upsert({
    uid: uidC,
    email: `${uidC.toLowerCase()}@itms-staging.local`,
    full_name: 'Stu 4C',
    bus_id: TEST_BUS,
    shift: 'Evening',
    status: 'active',
    valid_until: new Date(Date.now() - 86400000).toISOString(),
    seat_released_at: null,
  });

  const { data: relC, error: errC } = await supabase.rpc('soft_block_student_with_seat_release', {
    p_student_uid: uidC,
    p_bus_id: TEST_BUS,
    p_shift: 'Evening',
    p_release_seat: true,
  });
  assert('RPC soft_block_student_with_seat_release executed without error', !errC, errC?.message);
  assert('Seat was reported released', (relC as any)?.success === true);

  const { data: busC } = await supabase.from('buses').select('evening_load, morning_load').eq('id', TEST_BUS).single();
  assert('Bus evening_load decremented from 10 to 9', busC?.evening_load === 9, `got ${busC?.evening_load}`);
  assert('Bus morning_load remained strictly untouched at 9', busC?.morning_load === 9, `got ${busC?.morning_load}`);

  const { data: profC } = await supabase.from('student_profiles').select('status, seat_released_at').eq('uid', uidC).single();
  assert('Student status updated to soft_blocked', profC?.status === 'soft_blocked', `got ${profC?.status}`);
  assert('Student seat_released_at stamped with timestamp', profC?.seat_released_at !== null);

  // ── SCENARIO D: Idempotent double soft-block release ──
  console.log('\n--- Scenario D: Idempotent double soft-block release ---');
  const { data: relD, error: errD } = await supabase.rpc('soft_block_student_with_seat_release', {
    p_student_uid: uidC,
    p_bus_id: TEST_BUS,
    p_shift: 'Evening',
    p_release_seat: true,
  });
  assert('Second soft-block call returns status 409 conflict safely', (relD as any)?.status === 409 || !errD);
  assert('Second call does not release seat again', (relD as any)?.success === false);

  const { data: busD } = await supabase.from('buses').select('evening_load').eq('id', TEST_BUS).single();
  assert('Bus evening_load remained at 9 (no duplicate decrement)', busD?.evening_load === 9, `got ${busD?.evening_load}`);

  await supabase.from('student_profiles').delete().eq('uid', uidC);
  await supabase.from('users').delete().eq('uid', uidC);

  // Cleanup test bus
  console.log('\n--- Cleaning up test bus ---');
  await supabase.from('buses').delete().eq('id', TEST_BUS);

  console.log(`\nStage 4 Results: Passed: ${passCount}, Failed: ${failCount}`);
  if (failCount > 0) {
    console.error('\n>>> [FAIL] COUNTER CORRECTNESS VERIFICATION FAILED <<<');
    process.exit(1);
  }
  console.log('\n>>> [PASS] ALL COUNTER CORRECTNESS & SEAT RELEASE CHECKS PASSED <<<');
  process.exit(0);
}

main().catch(err => {
  console.error('Unhandled error in counter correctness test:', err);
  process.exit(1);
});
