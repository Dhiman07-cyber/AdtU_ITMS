import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const serviceClient = createClient(supabaseUrl, serviceRoleKey);
const anonClient = createClient(supabaseUrl, anonKey);

interface TestResult {
  name: string;
  passed: boolean;
  details?: any;
  error?: string;
}

const results: TestResult[] = [];

function record(name: string, passed: boolean, details?: any, error?: string) {
  results.push({ name, passed, details, error });
  const tag = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${tag} | ${name}`);
  if (details) console.log('   Details:', JSON.stringify(details));
  if (error) console.error('   Error:', error);
}

async function run() {
  console.log('=== REAL POSTGRESQL / SUPABASE PAYMENT VERIFICATION BATTERY ===\n');
  console.log(`Supabase URL: ${supabaseUrl}`);

  const testSuffix = Date.now().toString();
  const testPaymentId1 = `TEST_IMMUTABLE_${testSuffix}`;
  const testPaymentId2 = `TEST_REFUND_${testSuffix}`;
  const testPaymentId3 = `TEST_CONCURRENT_${testSuffix}`;

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Unauthorized execution of process_payment_refund_atomic via anon role
    // -------------------------------------------------------------------------
    console.log('\n--- 1. Security & RBAC: Anon Execution of Refund RPC ---');
    const { data: anonData, error: anonError } = await anonClient.rpc('process_payment_refund_atomic', {
      p_payment_id: 'any_id',
      p_refund_id: 'any_ref',
      p_amount_paise: 10000,
      p_authorized_by: { userId: 'unauthorized_anon' },
      p_reason: 'Test anon exploit',
    });

    const isAnonBlocked = Boolean(anonError && (
      anonError.code === '42501' || 
      anonError.message.includes('permission denied') ||
      anonError.message.includes('not found') ||
      anonError.code === 'PGRST202'
    ));
    record(
      'Anon role cannot execute process_payment_refund_atomic',
      isAnonBlocked,
      { rpcError: anonError?.message, code: anonError?.code }
    );

    // -------------------------------------------------------------------------
    // TEST 2: Immutability & Tamper Protection Trigger
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Database Trigger: Financial Immutability & Anti-Tamper ---');
    // Insert Completed payment record
    const { error: insertErr1 } = await serviceClient.from('payments').insert({
      payment_id: testPaymentId1,
      student_uid: `student_${testSuffix}`,
      student_id: `ENR_${testSuffix}`,
      student_name: 'Immutability Verification Student',
      amount: 10000.00,
      currency: 'INR',
      method: 'Online',
      status: 'Completed',
      session_start_year: 2026,
      session_end_year: 2027,
      duration_years: 1,
      razorpay_order_id: `order_imm_${testSuffix}`,
      razorpay_payment_id: `pay_imm_${testSuffix}`,
      metadata: { verification_test: true },
    });

    if (insertErr1) {
      throw new Error(`Failed to insert test payment 1: ${insertErr1.message}`);
    }
    record('Insert initial Completed payment for immutability testing', true, { payment_id: testPaymentId1 });

    // 2a: Attempt to alter amount
    const { error: tamperAmountErr } = await serviceClient
      .from('payments')
      .update({ amount: 5000.00 })
      .eq('payment_id', testPaymentId1);

    const amountTamperBlocked = Boolean(tamperAmountErr && tamperAmountErr.message.includes('Cannot mutate financial or identity fields'));
    record(
      'Attempt to mutate amount on Completed payment is blocked by trigger',
      amountTamperBlocked,
      { error: tamperAmountErr?.message }
    );

    // 2b: Attempt to alter student_uid
    const { error: tamperStudentErr } = await serviceClient
      .from('payments')
      .update({ student_uid: 'hacked_student_uid' })
      .eq('payment_id', testPaymentId1);

    const studentTamperBlocked = Boolean(tamperStudentErr && tamperStudentErr.message.includes('Cannot mutate financial or identity fields'));
    record(
      'Attempt to mutate student_uid on Completed payment is blocked by trigger',
      studentTamperBlocked,
      { error: tamperStudentErr?.message }
    );

    // 2c: Attempt to regress status to Pending
    const { error: regressStatusErr } = await serviceClient
      .from('payments')
      .update({ status: 'Pending' })
      .eq('payment_id', testPaymentId1);

    const statusRegressBlocked = Boolean(regressStatusErr && regressStatusErr.message.includes('Cannot mutate status of Completed payment record'));
    record(
      'Attempt to regress status from Completed to Pending is blocked by trigger',
      statusRegressBlocked,
      { error: regressStatusErr?.message }
    );

    // 2d: Attempt to DELETE finalized payment
    const { error: deleteErr } = await serviceClient
      .from('payments')
      .delete()
      .eq('payment_id', testPaymentId1);

    const deleteBlocked = Boolean(deleteErr && deleteErr.message.includes('Cannot delete finalized or audit payment record'));
    record(
      'Attempt to DELETE Completed payment is blocked by trigger',
      deleteBlocked,
      { error: deleteErr?.message }
    );

    // -------------------------------------------------------------------------
    // TEST 3: Atomic Cumulative Refund Scenarios
    // -------------------------------------------------------------------------
    console.log('\n--- 3. RPC: Atomic Cumulative Refund Execution ---');
    // Insert test payment 2: 5000 INR = 500,000 paise
    const { error: insertErr2 } = await serviceClient.from('payments').insert({
      payment_id: testPaymentId2,
      student_uid: `student_ref_${testSuffix}`,
      student_id: `ENR_REF_${testSuffix}`,
      student_name: 'Refund Verification Student',
      amount: 5000.00,
      currency: 'INR',
      method: 'Online',
      status: 'Completed',
      session_start_year: 2026,
      session_end_year: 2027,
      duration_years: 1,
      razorpay_order_id: `order_ref_${testSuffix}`,
      razorpay_payment_id: `pay_ref_${testSuffix}`,
      metadata: { verification_test: true, refund_history: [] },
    });

    if (insertErr2) {
      throw new Error(`Failed to insert test payment 2: ${insertErr2.message}`);
    }
    record('Insert initial Completed payment for refund testing', true, { payment_id: testPaymentId2 });

    // Scenario 3a: Validation of negative, zero, and missing parameters
    const { data: negData } = await serviceClient.rpc('process_payment_refund_atomic', {
      p_payment_id: testPaymentId2,
      p_refund_id: `rfnd_neg_${testSuffix}`,
      p_amount_paise: -100,
      p_authorized_by: { userId: 'admin_1', name: 'Admin Test' },
      p_reason: 'Negative test',
    });
    record('Negative refund amount rejected by RPC', negData?.success === false, negData);

    const { data: zeroData } = await serviceClient.rpc('process_payment_refund_atomic', {
      p_payment_id: testPaymentId2,
      p_refund_id: `rfnd_zero_${testSuffix}`,
      p_amount_paise: 0,
      p_authorized_by: { userId: 'admin_1', name: 'Admin Test' },
      p_reason: 'Zero test',
    });
    record('Zero refund amount rejected by RPC', zeroData?.success === false, zeroData);

    const { data: noRefData } = await serviceClient.rpc('process_payment_refund_atomic', {
      p_payment_id: testPaymentId2,
      p_refund_id: '   ',
      p_amount_paise: 100000,
      p_authorized_by: { userId: 'admin_1', name: 'Admin Test' },
      p_reason: 'Empty ref test',
    });
    record('Empty refund reference rejected by RPC', noRefData?.success === false, noRefData);

    const { data: noActorData } = await serviceClient.rpc('process_payment_refund_atomic', {
      p_payment_id: testPaymentId2,
      p_refund_id: `rfnd_no_actor_${testSuffix}`,
      p_amount_paise: 100000,
      p_authorized_by: { userId: '' },
      p_reason: 'Missing actor test',
    });
    record('Missing authorized actor rejected by RPC', noActorData?.success === false, noActorData);

    // Scenario 3b: Partial Refund 1 (2,000 INR = 200,000 paise)
    const refId1 = `rfnd_p1_${testSuffix}`;
    const { data: part1Data, error: part1Err } = await serviceClient.rpc('process_payment_refund_atomic', {
      p_payment_id: testPaymentId2,
      p_refund_id: refId1,
      p_amount_paise: 200000,
      p_authorized_by: { userId: 'admin_finance_01', name: 'Finance Officer A', role: 'admin' },
      p_reason: 'First installment refund',
    });

    const isPart1Ok = Boolean(
      part1Data?.success === true &&
      part1Data?.is_partial === true &&
      Number(part1Data?.cumulative_refunded) === 2000
    );
    record('Partial Refund 1 (2000 INR / 5000 INR) succeeds and retains Completed status', isPart1Ok, part1Data, part1Err?.message);

    // Verify row state in database after Partial Refund 1
    const { data: rowAfterPart1 } = await serviceClient
      .from('payments')
      .select('status, metadata')
      .eq('payment_id', testPaymentId2)
      .single();

    const isRow1Consistent = Boolean(
      rowAfterPart1?.status === 'Completed' &&
      Number(rowAfterPart1?.metadata?.refunded_amount) === 2000 &&
      rowAfterPart1?.metadata?.is_partially_refunded === true &&
      rowAfterPart1?.metadata?.refund_history?.length === 1
    );
    record('Database row retains Completed status with cumulative metadata after partial refund', isRow1Consistent, {
      status: rowAfterPart1?.status,
      metadata: rowAfterPart1?.metadata,
    });

    // Scenario 3c: Idempotent Replay of Partial Refund 1
    const { data: replayData } = await serviceClient.rpc('process_payment_refund_atomic', {
      p_payment_id: testPaymentId2,
      p_refund_id: refId1,
      p_amount_paise: 200000,
      p_authorized_by: { userId: 'admin_finance_01', name: 'Finance Officer A', role: 'admin' },
      p_reason: 'First installment refund retry',
    });

    const isReplayOk = Boolean(
      replayData?.success === true &&
      replayData?.already_processed === true &&
      Number(replayData?.cumulative_refunded) === 2000
    );
    record('Idempotent replay of same refund ID returns already_processed without duplicating amounts', isReplayOk, replayData);

    // Scenario 3d: Over-Refund Attempt (attempting 4,000 INR when only 3,000 INR remains refundable)
    const { data: overRefundData } = await serviceClient.rpc('process_payment_refund_atomic', {
      p_payment_id: testPaymentId2,
      p_refund_id: `rfnd_over_${testSuffix}`,
      p_amount_paise: 400000,
      p_authorized_by: { userId: 'admin_finance_01', name: 'Finance Officer A', role: 'admin' },
      p_reason: 'Excessive refund attempt',
    });

    const isOverRefundBlocked = Boolean(
      overRefundData?.success === false &&
      overRefundData?.error?.includes('cannot exceed original')
    );
    record('Over-refund attempt exceeding remaining refundable balance is rejected', isOverRefundBlocked, overRefundData);

    // Scenario 3e: Partial Refund 2 Reaching Full Amount (3,000 INR = 300,000 paise)
    const refId2 = `rfnd_p2_${testSuffix}`;
    const { data: part2Data, error: part2Err } = await serviceClient.rpc('process_payment_refund_atomic', {
      p_payment_id: testPaymentId2,
      p_refund_id: refId2,
      p_amount_paise: 300000,
      p_authorized_by: { userId: 'admin_finance_02', name: 'Finance Officer B', role: 'admin' },
      p_reason: 'Final refund balance',
    });

    const isPart2Ok = Boolean(
      part2Data?.success === true &&
      part2Data?.is_partial === false &&
      Number(part2Data?.cumulative_refunded) === 5000
    );
    record('Partial Refund 2 (3000 INR) completes the full refund and transitions to Refunded', isPart2Ok, part2Data, part2Err?.message);

    // Verify row state in database after Full Refund
    const { data: rowAfterFull } = await serviceClient
      .from('payments')
      .select('status, approved_by, approved_at, metadata')
      .eq('payment_id', testPaymentId2)
      .single();

    const isRowFullConsistent = Boolean(
      rowAfterFull?.status === 'Refunded' &&
      rowAfterFull?.approved_by !== null &&
      rowAfterFull?.approved_at !== null &&
      Number(rowAfterFull?.metadata?.refunded_amount) === 5000 &&
      rowAfterFull?.metadata?.refund_status === 'fully_refunded' &&
      rowAfterFull?.metadata?.refund_history?.length === 2
    );
    record('Database row transitions to terminal Refunded with complete audit history and approver metadata', isRowFullConsistent, {
      status: rowAfterFull?.status,
      approved_by: rowAfterFull?.approved_by,
      refunded_amount: rowAfterFull?.metadata?.refunded_amount,
      historyCount: rowAfterFull?.metadata?.refund_history?.length,
    });

    // Scenario 3f: Replay of refund on fully Refunded payment
    const { data: fullReplayData } = await serviceClient.rpc('process_payment_refund_atomic', {
      p_payment_id: testPaymentId2,
      p_refund_id: refId2,
      p_amount_paise: 300000,
      p_authorized_by: { userId: 'admin_finance_02', name: 'Finance Officer B', role: 'admin' },
      p_reason: 'Final refund replay',
    });

    const isFullReplayOk = Boolean(
      fullReplayData?.success === true &&
      fullReplayData?.already_processed === true
    );
    record('Replay on terminal Refunded payment returns already_processed without corruption', isFullReplayOk, fullReplayData);

    // Scenario 3g: New refund on already Refunded payment is rejected
    const { data: postFullRefundData } = await serviceClient.rpc('process_payment_refund_atomic', {
      p_payment_id: testPaymentId2,
      p_refund_id: `rfnd_excess_${testSuffix}`,
      p_amount_paise: 50000,
      p_authorized_by: { userId: 'admin_finance_02', name: 'Finance Officer B', role: 'admin' },
      p_reason: 'Extra refund on completed refund',
    });

    const isPostFullBlocked = Boolean(postFullRefundData?.success === false);
    record('New refund on already Refunded record is rejected', isPostFullBlocked, postFullRefundData);

    // -------------------------------------------------------------------------
    // TEST 4: Native PostgreSQL Concurrency & FOR UPDATE Row Locking
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Concurrency: Racing Refund Requests with FOR UPDATE ---');
    // Insert test payment 3: 4000 INR = 400,000 paise
    const { error: insertErr3 } = await serviceClient.from('payments').insert({
      payment_id: testPaymentId3,
      student_uid: `student_conc_${testSuffix}`,
      student_id: `ENR_CONC_${testSuffix}`,
      student_name: 'Concurrent Race Student',
      amount: 4000.00,
      currency: 'INR',
      method: 'Online',
      status: 'Completed',
      session_start_year: 2026,
      session_end_year: 2027,
      duration_years: 1,
      razorpay_order_id: `order_conc_${testSuffix}`,
      razorpay_payment_id: `pay_conc_${testSuffix}`,
      metadata: { verification_test: true, refund_history: [] },
    });

    if (insertErr3) throw new Error(`Failed to insert test payment 3: ${insertErr3.message}`);

    // Two distinct refund requests race simultaneously: Request A (3000 INR) and Request B (3000 INR)
    // Only one can succeed! Combined they equal 6000 INR > 4000 INR.
    const racePromise1 = serviceClient.rpc('process_payment_refund_atomic', {
      p_payment_id: testPaymentId3,
      p_refund_id: `rfnd_race_A_${testSuffix}`,
      p_amount_paise: 300000,
      p_authorized_by: { userId: 'admin_conc_A' },
      p_reason: 'Race attempt A',
    });

    const racePromise2 = serviceClient.rpc('process_payment_refund_atomic', {
      p_payment_id: testPaymentId3,
      p_refund_id: `rfnd_race_B_${testSuffix}`,
      p_amount_paise: 300000,
      p_authorized_by: { userId: 'admin_conc_B' },
      p_reason: 'Race attempt B',
    });

    const [raceRes1, raceRes2] = await Promise.all([racePromise1, racePromise2]);
    const outcomes = [raceRes1.data, raceRes2.data];
    const successes = outcomes.filter(o => o?.success === true);
    const failures = outcomes.filter(o => o?.success === false);

    const isRaceSafe = Boolean(
      successes.length === 1 &&
      failures.length === 1 &&
      failures[0]?.error?.includes('cannot exceed original')
    );
    record(
      'Racing concurrent refund requests serialized by FOR UPDATE: exactly one commits, second rejected for balance exhaustion',
      isRaceSafe,
      { successes: successes.length, failures: failures.length, failureError: failures[0]?.error }
    );

    // Verify row state in database after race
    const { data: rowAfterRace } = await serviceClient
      .from('payments')
      .select('status, metadata')
      .eq('payment_id', testPaymentId3)
      .single();

    const isRaceRowSound = Boolean(
      rowAfterRace?.status === 'Completed' &&
      Number(rowAfterRace?.metadata?.refunded_amount) === 3000 &&
      Number(rowAfterRace?.metadata?.remaining_amount) === 1000 &&
      rowAfterRace?.metadata?.refund_history?.length === 1
    );
    record(
      'Database row strictly reflects exactly 3000 INR refunded with 1000 INR remaining balance',
      isRaceRowSound,
      { status: rowAfterRace?.status, metadata: rowAfterRace?.metadata }
    );

  } catch (err: any) {
    console.error('\n💥 Unexpected verification error:', err);
    record('Fatal test run exception', false, null, err.message);
  }

  // ---------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------
  console.log('\n===============================================================');
  console.log('  VERIFICATION BATTERY SUMMARY');
  console.log('===============================================================');
  const passCount = results.filter(r => r.passed).length;
  const failCount = results.filter(r => !r.passed).length;
  console.log(`Total checks:  ${results.length}`);
  console.log(`Passed:        ${passCount}`);
  console.log(`Failed:        ${failCount}`);
  console.log(`Final Verdict: ${failCount === 0 ? 'ALL CHECKS PASSED ✅' : 'FAILURES DETECTED ❌'}`);
  console.log('===============================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

run();
