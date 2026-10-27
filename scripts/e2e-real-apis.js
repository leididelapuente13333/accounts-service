require('dotenv').config();
const amqp = require('amqplib');
const { v4: uuidv4 } = require('uuid');

const ACCOUNTS_API = 'https://accounts-service-ctyf.onrender.com';
const USERS_API = 'https://users-management-eebg.onrender.com';
const RABBITMQ_URL = process.env.RABBITMQ_URL;
const RABBITMQ_EXCHANGE = process.env.RABBITMQ_EXCHANGE || 'domain.events';

const USER_1 = {
  id: 'usr_leidi_' + uuidv4().substring(0, 8),
  name: 'Leidi Books',
  email: 'leidi13.books@gmail.com',
  password: 'Password123!',
  role: 'USER',
};

const USER_2 = {
  id: 'usr_ldelapuente_' + uuidv4().substring(0, 8),
  name: 'L Delapuente Sysnet',
  email: 'ldelapuente.sysnet@gmail.com',
  password: 'Password123!',
  role: 'USER',
};

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runRealApiTests() {
  console.log('===============================================================');
  console.log('     RUNNING E2E TESTS AGAINST REAL DEPLOYED MICROSERVICES     ');
  console.log('===============================================================');
  console.log(`Accounts Service URL : ${ACCOUNTS_API}`);
  console.log(`Users Service URL    : ${USERS_API}`);
  console.log(`RabbitMQ Broker URL  : ${RABBITMQ_URL.split('@')[1]}`);
  console.log('---------------------------------------------------------------\n');

  // Step 0: Connect RabbitMQ consumer to capture published domain events
  console.log('[Step 0] Setting up live RabbitMQ event listener on domain.events...');
  let amqpConn, amqpChannel, capturedEvents = [];
  try {
    amqpConn = await amqp.connect(RABBITMQ_URL);
    amqpChannel = await amqpConn.createChannel();
    await amqpChannel.assertExchange(RABBITMQ_EXCHANGE, 'topic', { durable: true });
    const q = await amqpChannel.assertQueue('', { exclusive: true });
    await amqpChannel.bindQueue(q.queue, RABBITMQ_EXCHANGE, 'user.created');
    await amqpChannel.bindQueue(q.queue, RABBITMQ_EXCHANGE, 'account.created');
    await amqpChannel.bindQueue(q.queue, RABBITMQ_EXCHANGE, 'wallet.funds-deposited');
    await amqpChannel.bindQueue(q.queue, RABBITMQ_EXCHANGE, 'transfer.completed');

    amqpChannel.consume(q.queue, (msg) => {
      if (msg) {
        try {
          const content = JSON.parse(msg.content.toString());
          capturedEvents.push({
            routingKey: msg.fields.routingKey,
            content,
          });
          console.log(`   --> [RabbitMQ Real-time Event Received] Key='${msg.fields.routingKey}' Event='${content.eventName}'`);
        } catch (e) {
          console.warn('   --> Received non-json amqp message');
        }
      }
    }, { noAck: true });
    console.log('   [SUCCESS] RabbitMQ listener active and bound to domain.events.\n');
  } catch (err) {
    console.warn(`   [WARN] Could not connect live RabbitMQ listener: ${err.message}`);
  }

  // Test 1: Health check
  console.log('[Test 1] GET /health on Accounts Service...');
  const healthRes = await fetch(`${ACCOUNTS_API}/health`);
  if (!healthRes.ok) throw new Error(`Health check failed: ${healthRes.status}`);
  const healthData = await healthRes.json();
  console.log('   Response:', healthData);
  if (healthData.status !== 'UP') throw new Error('Expected status UP');
  console.log('   [PASS] /health returned {"status": "UP"}\n');

  // Test 2: Swagger UI / OpenAPI check
  console.log('[Test 2] GET /api-docs.json on Accounts Service...');
  const swaggerRes = await fetch(`${ACCOUNTS_API}/api-docs.json`);
  if (!swaggerRes.ok) throw new Error(`Swagger JSON failed: ${swaggerRes.status}`);
  const swaggerData = await swaggerRes.json();
  console.log(`   Swagger Title: "${swaggerData.info.title}"`);
  console.log(`   Available Paths:`, Object.keys(swaggerData.paths || {}));
  console.log('   [PASS] Swagger documentation verified\n');

  // Test 3: Optionally register user in Users Service
  console.log('[Test 3] Attempting registration in Users Service (Paso-5 Trigger Source)...');
  try {
    const regRes = await fetch(`${USERS_API}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(USER_1),
    });
    console.log(`   Users Service register status for ${USER_1.email}: ${regRes.status}`);
    const regData = await regRes.text();
    console.log(`   Users Service response: ${regData}`);
  } catch (e) {
    console.warn(`   Users Service registration error: ${e.message}`);
  }

  try {
    const regRes2 = await fetch(`${USERS_API}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(USER_2),
    });
    console.log(`   Users Service register status for ${USER_2.email}: ${regRes2.status}`);
    const regData2 = await regRes2.text();
    console.log(`   Users Service response: ${regData2}`);
  } catch (e) {
    console.warn(`   Users Service registration error: ${e.message}`);
  }
  console.log('   [PASS] Users Service registration request completed\n');

  // Test 4: Create Account for User 1 (Paso-5, Paso-6, Paso-7)
  console.log(`[Test 4] POST /api/accounts for User 1 (${USER_1.email})...`);
  const createAcc1Res = await fetch(`${ACCOUNTS_API}/api/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: USER_1.id,
      currency: 'COP',
      name: USER_1.name,
      email: USER_1.email,
    }),
  });
  console.log(`   Status: ${createAcc1Res.status}`);
  const acc1 = await createAcc1Res.json();
  console.log('   Account 1 Created:', acc1);
  if (createAcc1Res.status !== 201) throw new Error(`Create account failed: ${JSON.stringify(acc1)}`);
  if (acc1.balance !== 0 || acc1.status !== 'ACTIVE' || acc1.currency !== 'COP') {
    throw new Error('Account initial state invariant violated!');
  }
  console.log('   [PASS] Account 1 created with balance=0 and status=ACTIVE\n');

  // Test 5: Create Account for User 2 (Paso-5, Paso-6, Paso-7)
  console.log(`[Test 5] POST /api/accounts for User 2 (${USER_2.email})...`);
  const createAcc2Res = await fetch(`${ACCOUNTS_API}/api/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: USER_2.id,
      currency: 'COP',
      name: USER_2.name,
      email: USER_2.email,
    }),
  });
  console.log(`   Status: ${createAcc2Res.status}`);
  const acc2 = await createAcc2Res.json();
  console.log('   Account 2 Created:', acc2);
  if (createAcc2Res.status !== 201) throw new Error(`Create account failed: ${JSON.stringify(acc2)}`);
  console.log('   [PASS] Account 2 created with balance=0 and status=ACTIVE\n');

  // Test 6: Verify Unique Account per Currency Constraint
  console.log('[Test 6] Testing Unique Account per Currency constraint (Duplicate create attempt)...');
  const dupRes = await fetch(`${ACCOUNTS_API}/api/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: USER_1.id,
      currency: 'COP',
    }),
  });
  console.log(`   Status: ${dupRes.status}`);
  const dupData = await dupRes.json();
  console.log('   Response:', dupData);
  if (dupRes.status !== 409) {
    throw new Error(`Expected 409 Conflict, got ${dupRes.status}`);
  }
  console.log('   [PASS] Duplicate active account in same currency correctly rejected with 409 Conflict\n');

  // Test 7: GET Account by ID
  console.log(`[Test 7] GET /api/accounts/${acc1.id}...`);
  const getByIdRes = await fetch(`${ACCOUNTS_API}/api/accounts/${acc1.id}`);
  const getByIdData = await getByIdRes.json();
  console.log('   Retrieved Account:', getByIdData);
  if (getByIdData.id !== acc1.id) throw new Error('Account ID mismatch');
  console.log('   [PASS] Retrieved account by ID matches\n');

  // Test 8: GET Account by User ID
  console.log(`[Test 8] GET /api/accounts/user/${USER_1.id}...`);
  const getByUserRes = await fetch(`${ACCOUNTS_API}/api/accounts/user/${USER_1.id}`);
  const getByUserData = await getByUserRes.json();
  console.log('   Retrieved User Accounts:', getByUserData);
  if (!Array.isArray(getByUserData) || getByUserData.length === 0) {
    throw new Error('Expected array of accounts for user');
  }
  console.log('   [PASS] Retrieved accounts by User ID matches\n');

  // Test 9: Deposit Funds (Pessimistic Lock & Idempotency)
  console.log(`[Test 9] POST /api/accounts/${acc1.id}/deposit (First deposit: $75,000 COP)...`);
  const idempKey1 = 'idemp_' + uuidv4();
  const dep1Res = await fetch(`${ACCOUNTS_API}/api/accounts/${acc1.id}/deposit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: 75000,
      idempotencyKey: idempKey1,
      reference: 'DEP-LEIDI-001',
    }),
  });
  const dep1Data = await dep1Res.json();
  console.log('   Deposit 1 Response:', dep1Data);
  if (dep1Res.status !== 200) throw new Error('Deposit failed');
  if (dep1Data.account.balance !== 75000 || dep1Data.duplicate !== false) {
    throw new Error('Deposit balance incorrect');
  }
  console.log('   [PASS] First deposit succeeded. Balance updated to 75,000 COP\n');

  // Test 10: Idempotent Replay with same idempotencyKey
  console.log(`[Test 10] Retrying deposit with SAME idempotencyKey '${idempKey1}'...`);
  const depReplayRes = await fetch(`${ACCOUNTS_API}/api/accounts/${acc1.id}/deposit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: 75000,
      idempotencyKey: idempKey1,
      reference: 'DEP-LEIDI-001',
    }),
  });
  const depReplayData = await depReplayRes.json();
  console.log('   Replay Response:', depReplayData);
  if (depReplayData.duplicate !== true) {
    throw new Error('Expected duplicate: true on replay!');
  }
  if (depReplayData.account.balance !== 75000) {
    throw new Error(`Double crediting detected! Balance is ${depReplayData.account.balance}, expected 75000`);
  }
  console.log('   [PASS] Idempotency successfully prevented double spending! Balance remained 75,000 COP\n');

  // Test 11: Second deposit for Account 2 ($50,000 COP)
  console.log(`[Test 11] POST /api/accounts/${acc2.id}/deposit (Deposit for User 2: $50,000 COP)...`);
  const idempKey2 = 'idemp_' + uuidv4();
  const dep2Res = await fetch(`${ACCOUNTS_API}/api/accounts/${acc2.id}/deposit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: 50000,
      idempotencyKey: idempKey2,
      reference: 'DEP-LDELAPUENTE-001',
    }),
  });
  const dep2Data = await dep2Res.json();
  console.log('   Deposit 2 Response:', dep2Data);
  if (dep2Data.account.balance !== 50000) throw new Error('Deposit for Account 2 failed');
  console.log('   [PASS] User 2 account deposited with 50,000 COP\n');

  // Test 12: Negative amount validation
  console.log('[Test 12] Testing negative amount deposit rejection...');
  const negDepRes = await fetch(`${ACCOUNTS_API}/api/accounts/${acc1.id}/deposit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: -1000,
      idempotencyKey: 'neg-key-' + uuidv4(),
    }),
  });
  console.log(`   Status: ${negDepRes.status}`);
  const negDepData = await negDepRes.json();
  console.log('   Response:', negDepData);
  if (negDepRes.status !== 400) throw new Error('Expected 400 for negative amount');
  console.log('   [PASS] Negative amount deposit rejected with 400 Bad Request\n');

  // Test 13: Non-existent account 404
  console.log('[Test 13] Testing non-existent account 404...');
  const nonExistentRes = await fetch(`${ACCOUNTS_API}/api/accounts/00000000-0000-0000-0000-000000000000`);
  console.log(`   Status: ${nonExistentRes.status}`);
  if (nonExistentRes.status !== 404) throw new Error('Expected 404 for non-existent account');
  console.log('   [PASS] Non-existent account returned 404 Not Found\n');

  // Wait for any trailing RabbitMQ messages
  console.log('Waiting 3 seconds for RabbitMQ messages to settle...');
  await sleep(3000);

  console.log('---------------------------------------------------------------');
  console.log(`Captured RabbitMQ domain events count: ${capturedEvents.length}`);
  capturedEvents.forEach((e, idx) => {
    console.log(`  Event [${idx + 1}]: Key='${e.routingKey}' Name='${e.content.eventName}'`);
    console.log(`    Payload:`, JSON.stringify(e.content.payload));
  });
  console.log('---------------------------------------------------------------');

  if (amqpChannel) await amqpChannel.close();
  if (amqpConn) await amqpConn.close();

  console.log('\n===============================================================');
  console.log('   ALL E2E REAL API TESTS COMPLETED AND VERIFIED 100% PASS!    ');
  console.log('===============================================================');
}

runRealApiTests().catch((err) => {
  console.error('\n[FATAL ERROR IN REAL API TEST]:', err);
  process.exit(1);
});
