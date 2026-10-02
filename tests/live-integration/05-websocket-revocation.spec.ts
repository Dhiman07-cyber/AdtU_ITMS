/**
 * tests/live-integration/05-websocket-revocation.spec.ts
 *
 * AUTHORITATIVE LIVE WEBSOCKET ENTITLEMENT & CROSS-NODE REVOCATION SUITE
 *
 * Exercises the ACTUAL live running infrastructure:
 * - Real Supabase PostgreSQL database (real student, driver, bus records)
 * - Real Firebase Auth (mintIdToken via official Google Identity Toolkit)
 * - Real Docker WebSocket instances (itms-ws1 on port 3001, itms-ws2 on port 3003)
 * - Real Docker Redis Pub/Sub (itms-redis on 127.0.0.1:6379)
 *
 * Test battery:
 * 1. Authenticated connection via real Firebase ID token
 * 2. Authorized student presence reporting on assigned bus (accepted)
 * 3. Unauthorized student presence reporting on unassigned bus (rejected)
 * 4. Default-deny on privileged channel subscription (rejected)
 * 5. Cross-node revocation via Redis Pub/Sub: publishing to 'role_invalidate'
 *    causes running WS container to instantly terminate socket with code 4401
 */

import { execSync } from 'child_process';
import { loadPersonas, mintIdToken, supabase, sleep, WS_BASE } from '../../scripts/staging/lib';
import { WsAgent, type ReceivedMessage } from '../../scripts/staging/ws-agent';

async function main() {
  console.log('\n===============================================================');
  console.log('  STAGE 6: LIVE WEBSOCKET ENTITLEMENT & CROSS-NODE REVOCATION');
  console.log('===============================================================\n');

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

  // 1. Load real personas from staging dataset
  const personas = loadPersonas();
  if (!personas || personas.students.length === 0 || personas.drivers.length === 0) {
    throw new Error('Personas missing. Staging dataset not loaded.');
  }

  const student = personas.students[0];
  const busId = student.busId || personas.buses[0]?.id;
  const unassignedBus = personas.buses.find((b) => b.id !== busId)?.id || 'UNASSIGNED_BUS_999';

  console.log(`Using live persona: Student=${student.label} (UID=${student.uid}), AssignedBus=${busId}`);

  // 2. Mint real Firebase ID Token
  console.log('\n--- 1. Minting Real Firebase ID Token ---');
  const token = await mintIdToken(student.uid);
  assert('Firebase ID token minted successfully', !!token && token.length > 500);

  // 3. Connect to live Docker WebSocket container (itms-ws1 on port 3001)
  console.log(`\n--- 2. Connecting to Live WebSocket Container (${WS_BASE}) ---`);
  const agent = new WsAgent(WS_BASE);
  const receivedMessages: any[] = [];

  const rawWsClient = agent as any;
  await agent.connect(token);
  assert('Connected and authenticated with live WS server', agent.role === 'student' && agent.uid === student.uid);

  const ws = rawWsClient.ws;
  ws.on('message', (data: any) => {
    try {
      receivedMessages.push(JSON.parse(data.toString()));
    } catch {}
  });

  let closeCode: number | null = null;
  let closeReason = '';
  ws.on('close', (code: number, reason: Buffer) => {
    closeCode = code;
    closeReason = reason.toString();
  });

  // 4. Test Authorized Presence Reporting on Assigned Bus
  console.log('\n--- 3. Authorized Presence Reporting (Assigned Bus) ---');
  agent.send({
    type: 'presence',
    busId,
  });
  await sleep(1200);

  const presenceOk = receivedMessages.find((m) => m.type === 'presence_ok');
  assert('Presence reporting accepted for assigned bus', presenceOk !== undefined, JSON.stringify(receivedMessages));

  // 5. Test Unauthorized Presence Reporting on Unassigned Bus
  console.log('\n--- 4. Unauthorized Presence Reporting (Unassigned Bus) ---');
  const msgCountBefore = receivedMessages.length;
  agent.send({
    type: 'presence',
    busId: unassignedBus,
  });
  await sleep(1200);

  const unassignedErr = receivedMessages.slice(msgCountBefore).find(
    (m) => m.type === 'error' && m.message?.toLowerCase().includes('unauthorized')
  );
  assert('Presence reporting rejected for unassigned bus', unassignedErr !== undefined, JSON.stringify(receivedMessages.slice(msgCountBefore)));

  // 6. Test Default-Deny Channel Subscription
  console.log('\n--- 5. Privileged Channel Default-Deny Test ---');
  const msgCountBeforeSub = receivedMessages.length;
  agent.send({
    type: 'subscribe',
    channel: 'admin_audit_stream',
  });
  await sleep(1200);

  const subError = receivedMessages.slice(msgCountBeforeSub).find(
    (m) => m.type === 'error' && (m.message?.toLowerCase().includes('not authorized') || m.message?.toLowerCase().includes('forbidden'))
  );
  assert('Privileged channel subscription denied with authorization error', subError !== undefined, JSON.stringify(receivedMessages.slice(msgCountBeforeSub)));

  // 7. Test Cross-Node Revocation via Live Redis Pub/Sub
  console.log('\n--- 6. Live Cross-Node Revocation via Redis Pub/Sub ---');
  console.log(`Publishing revocation for UID ${student.uid} to Docker Redis channel 'role_invalidate'...`);
  execSync(`docker exec itms-redis redis-cli publish role_invalidate ${student.uid}`, { encoding: 'utf8' });

  // Wait for revocation to close socket
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && closeCode === null) {
    await sleep(200);
  }

  assert('Socket terminated following Redis role_invalidate broadcast', closeCode !== null, `closeCode=${closeCode}`);
  assert('Socket closed with 4401 Unauthorized code', closeCode === 4401, `got: ${closeCode}`);
  assert('Reason contains re-authenticate prompt', closeReason.toLowerCase().includes('re-authenticate'), `reason: ${closeReason}`);

  console.log('\n=== STAGE 6 SUMMARY ===');
  console.log(`Passed: ${passCount}`);
  console.log(`Failed: ${failCount}`);

  if (failCount > 0) {
    console.error('\n>>> [FAIL] STAGE 6 WEBSOCKET REVOCATION TEST FAILED <<<');
    process.exit(1);
  } else {
    console.log('\n>>> [PASS] ALL LIVE WEBSOCKET ENTITLEMENT & REVOCATION CHECKS PASSED <<<');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Stage 6 unhandled error:', err);
  process.exit(1);
});
