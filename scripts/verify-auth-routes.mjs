// Comprehensive verification script for Heirloom Authentication, OTP, Sessions & Routes
import { strictEqual, ok } from 'node:assert';

const RELAY_URL = 'http://127.0.0.1:3001';
const VITE_URL = 'http://127.0.0.1:5173';

async function testAll() {
  console.log('--- 1. Testing Config & Chain Connectivity ---');
  const configRes = await fetch(`${RELAY_URL}/api/config`);
  strictEqual(configRes.status, 200, 'Config should return 200');
  const config = await configRes.json();
  ok(config.chainId === 31337, 'Chain ID should be 31337');
  console.log('✓ Config endpoint verified:', config.contractAddress);

  console.log('\n--- 2. Testing Invalid Login Credentials ---');
  const badLoginRes = await fetch(`${RELAY_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'nonexistent@example.com', password: 'wrongpassword' }),
  });
  strictEqual(badLoginRes.status, 400, 'Invalid login should return 400');
  const badLoginData = await badLoginRes.json();
  ok(badLoginData.error.includes('Invalid email or password'), 'Should reject bad credentials');
  console.log('✓ Bad login properly rejected:', badLoginData.error);

  console.log('\n--- 3. Testing Real OTP Dispatch & Verification Flow ---');
  const testEmail = `testuser_${Date.now()}@example.com`;
  const otpSendRes = await fetch(`${RELAY_URL}/api/auth/send-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail }),
  });
  strictEqual(otpSendRes.status, 200, 'Send OTP should return 200');
  const otpSendData = await otpSendRes.json();
  ok(otpSendData.ok === true, 'Send OTP should be ok');
  ok(otpSendData.devCode, 'Dev code should be available in test/trial mode');
  console.log('✓ OTP generated and dispatched:', otpSendData.devCode);

  console.log('\n--- 4. Testing OTP Code Verification ---');
  // Test wrong code
  const wrongOtpRes = await fetch(`${RELAY_URL}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, code: '000000' }),
  });
  strictEqual(wrongOtpRes.status, 400, 'Wrong OTP should return 400');
  console.log('✓ Wrong OTP code properly rejected');

  // Test correct code
  const correctOtpRes = await fetch(`${RELAY_URL}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, code: otpSendData.devCode }),
  });
  strictEqual(correctOtpRes.status, 200, 'Correct OTP should return 200');
  const verifyData = await correctOtpRes.json();
  ok(verifyData.verified === true, 'Email should be marked verified');
  console.log('✓ OTP verification succeeded:', verifyData.message);

  console.log('\n--- 5. Testing Account Registration After OTP ---');
  const registerRes = await fetch(`${RELAY_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Charlotte Vance',
      email: testEmail,
      password: 'SecurePassword123!',
      role: 'owner',
    }),
  });
  strictEqual(registerRes.status, 200, 'Register should return 200');
  const registerData = await registerRes.json();
  ok(registerData.token, 'Should issue session token');
  ok(registerData.user.address, 'Should assign funded address');
  strictEqual(registerData.user.name, 'Charlotte Vance');
  strictEqual(registerData.user.role, 'owner');
  console.log('✓ Registration successful:', registerData.user);

  console.log('\n--- 6. Testing Login with New User Account ---');
  const loginRes = await fetch(`${RELAY_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: testEmail,
      password: 'SecurePassword123!',
    }),
  });
  strictEqual(loginRes.status, 200, 'Login should return 200');
  const loginData = await loginRes.json();
  ok(loginData.token, 'Should return session token');
  strictEqual(loginData.user.email, testEmail);
  console.log('✓ Login verified for registered user. Token:', loginData.token.slice(0, 16) + '...');

  console.log('\n--- 7. Testing 1-Click Local Demo Actor Login ---');
  const actor = config.actors[0]; // Alex Morgan
  const demoLoginRes = await fetch(`${RELAY_URL}/api/auth/demo-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: actor.address }),
  });
  strictEqual(demoLoginRes.status, 200, 'Demo login should return 200');
  const demoLoginData = await demoLoginRes.json();
  ok(demoLoginData.token, 'Should return demo session token');
  strictEqual(demoLoginData.user.name, actor.name);
  strictEqual(demoLoginData.user.role, actor.role);
  console.log('✓ 1-Click demo login verified for:', actor.name);

  console.log('\n--- 8. Testing Session Restoration via Bearer Token ---');
  const sessionRes = await fetch(`${RELAY_URL}/api/auth/session`, {
    headers: { Authorization: `Bearer ${demoLoginData.token}` },
  });
  strictEqual(sessionRes.status, 200, 'Session endpoint should return 200');
  const sessionData = await sessionRes.json();
  ok(sessionData.ok === true);
  strictEqual(sessionData.user.name, actor.name);
  console.log('✓ Session restored successfully from token:', sessionData.user.email);

  console.log('\n--- 9. Testing Session Revocation on Logout ---');
  const logoutRes = await fetch(`${RELAY_URL}/api/auth/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${demoLoginData.token}` },
  });
  strictEqual(logoutRes.status, 200, 'Logout should return 200');
  const afterLogoutRes = await fetch(`${RELAY_URL}/api/auth/session`, {
    headers: { Authorization: `Bearer ${demoLoginData.token}` },
  });
  const afterLogoutData = await afterLogoutRes.json();
  strictEqual(afterLogoutData.user, null, 'Session should be revoked after logout');
  console.log('✓ Logout successfully invalidated session token');

  console.log('\n--- 10. Testing Vite Dev Server Workspace Routes ---');
  for (const route of ['/', '/signup', '/login', '/owner', '/beneficiary', '/guardian', '/app']) {
    const res = await fetch(`${VITE_URL}${route}`);
    strictEqual(res.status, 200, `Route ${route} should return 200 on Vite`);
    const text = await res.text();
    ok(text.includes('id="root"'), `Route ${route} should contain root element`);
    console.log(`✓ Route ${route} served correctly by Vite`);
  }

  console.log('\n--- 11. Testing Express Static & SPA Fallback for Workspaces ---');
  for (const route of ['/', '/signup', '/login', '/owner', '/beneficiary', '/guardian', '/app']) {
    const res = await fetch(`${RELAY_URL}${route}`);
    strictEqual(res.status, 200, `Route ${route} should return 200 on Express SPA fallback`);
    const text = await res.text();
    ok(text.includes('id="root"'), `Route ${route} should contain SPA bundle`);
    console.log(`✓ Route ${route} served correctly by Express`);
  }

  console.log('\n--- 12. Testing Demo Accounts for All 3 Workspace Roles ---');
  for (const act of config.actors) {
    const actLoginRes = await fetch(`${RELAY_URL}/api/auth/demo-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: act.address }),
    });
    strictEqual(actLoginRes.status, 200, `Demo login should work for ${act.name}`);
    const actData = await actLoginRes.json();
    strictEqual(actData.user.role, act.role, `Role should match for ${act.name}`);
    const expectedRoute = act.role === 'owner' ? '/owner' : act.role === 'beneficiary' ? '/beneficiary' : '/guardian';
    console.log(`✓ Actor ${act.name} authenticated with role [${act.role}] -> Target workspace: ${expectedRoute}`);
  }

  console.log('\n=============================================');
  console.log('ALL 12 AUTHENTICATION AND WORKSPACE TESTS PASSED!');
  console.log('=============================================\n');
}

testAll().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
