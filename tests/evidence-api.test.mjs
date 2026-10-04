import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { Wallet } from 'ethers';
import { initStorage } from '../server/storage.mjs';
import { evidenceCommitment, evidenceEnrollmentMessage } from '../shared/evidence-identity.mjs';
import { createEvidenceHandlers } from '../server/evidence.mjs';

const vaultId = `0x${'a1'.repeat(32)}`;
const saltHex = '11'.repeat(32);
const pdf = Buffer.from('%PDF-1.4\nlocal signed evidence bytes\n');

function verifierResult() {
  return {
    signature: 'pass', coverage: 'pass', chain: 'pass', revocation: 'pass', issuer: 'pass', fields: 'pass',
    signerFingerprint: 'ef'.repeat(32), issuerLabel: 'Heirloom local test issuer',
    claims: { name: 'Demo Person', identifier: 'DEMO-042', dateOfDeath: '2026-10-01' }, reasonCodes: []
  };
}

async function setup(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'heirloom-evidence-api-'));
  const file = join(directory, 'relay.json');
  const storage = await initStorage({ file, databaseUrl: '' });
  const owner = Wallet.createRandom(), guardian = Wallet.createRandom(), beneficiary = Wallet.createRandom();
  const config = {
    chainId: 31337, contractAddress: `0x${'22'.repeat(20)}`, deploymentId: `0x${'33'.repeat(32)}`,
    mode: 'local', actors: [
      { address: owner.address, role: 'owner', name: 'Owner' },
      { address: guardian.address, role: 'guardian', name: 'Guardian' },
      { address: beneficiary.address, role: 'beneficiary', name: 'Beneficiary' }
    ]
  };
  const state = { owner: owner.address, beneficiary: beneficiary.address, guardians: [guardian.address], status: 0, requestId: 0 };
  for (const [token, wallet] of [['owner-token', owner], ['guardian-token', guardian], ['beneficiary-token', beneficiary]]) {
    await storage.saveSession(token, {
      userId: token, email: `${token}@heirloom.local`, isDemo: true, actorAddress: wallet.address,
      createdAt: Date.now(), expiresAt: Date.now() + 60_000
    });
  }
  const handlers = createEvidenceHandlers({
    storage, config, vaultState: async () => ({ ...state }),
    verifyPdf: options.verifyPdf ?? (async () => verifierResult()),
    timeoutMs: options.timeoutMs ?? 20_000
  });
  const app = express();
  app.use(express.json({ limit: '15mb' }));
  app.post('/api/evidence/:vaultId/enrollment', handlers.enroll);
  app.get('/api/evidence/:vaultId/enrollment', handlers.getEnrollment);
  app.post('/api/evidence/:vaultId', express.raw({ type: 'application/pdf', limit: '10mb' }), handlers.upload);
  app.get('/api/evidence/:vaultId', handlers.getCurrentReceipt);
  app.use((error, _req, res, _next) => res.status(error.status || 400).json({ error: error.message }));
  const server = await new Promise(resolve => { const running = app.listen(0, '127.0.0.1', () => resolve(running)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await storage.close();
    rmSync(directory, { recursive: true, force: true });
  });
  async function request(method, path, token, body, type = 'application/json') {
    const response = await fetch(`${base}/api/evidence/${vaultId}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': type }) },
      body: body === undefined ? undefined : type === 'application/json' ? JSON.stringify(body) : body
    });
    return { status: response.status, body: await response.json() };
  }
  async function enroll(token = 'owner-token', signatureWallet = owner, extra = {}) {
    const commitment = await evidenceCommitment('Demo Person', 'DEMO-042', saltHex);
    const signature = await signatureWallet.signMessage(evidenceEnrollmentMessage(config, vaultId, owner.address, commitment, saltHex));
    return request('POST', '/enrollment', token, { owner: owner.address, commitment, saltHex, signature, ...extra });
  }
  return { request, enroll, state, storage, file, owner, guardian, beneficiary };
}

test('owner can enroll only before any recovery request, and plaintext fields are rejected', async t => {
  const ctx = await setup(t);
  assert.equal((await ctx.enroll('owner-token', ctx.owner, { name: 'Demo Person' })).status, 400);
  assert.equal((await ctx.enroll()).status, 200);
  assert.equal((await ctx.request('GET', '/enrollment', 'guardian-token')).body.enrolled, true);
  assert.equal((await ctx.enroll()).status, 200);
  ctx.state.status = 1; ctx.state.requestId = 1;
  assert.equal((await ctx.enroll()).status, 409);
  assert.equal(readFileSync(ctx.file, 'utf8').includes('Demo Person'), false);
  assert.equal(readFileSync(ctx.file, 'utf8').includes('DEMO-042'), false);
});

test('session and wallet signature must both belong to the on-chain owner', async t => {
  const ctx = await setup(t);
  assert.equal((await ctx.enroll('guardian-token')).status, 403);
  assert.equal((await ctx.enroll('owner-token', ctx.guardian)).status, 403);
  assert.equal((await ctx.request('POST', '/enrollment', null, {})).status, 401);
  assert.equal((await ctx.request('GET', '/enrollment', 'beneficiary-token')).status, 403);
});

test('only a designated guardian can upload and read evidence for a live request', async t => {
  const ctx = await setup(t);
  await ctx.enroll();
  ctx.state.status = 1; ctx.state.requestId = 1;
  assert.equal((await ctx.request('POST', '', 'owner-token', pdf, 'application/pdf')).status, 403);
  assert.equal((await ctx.request('POST', '', 'beneficiary-token', pdf, 'application/pdf')).status, 403);
  assert.equal((await ctx.request('GET', '', 'owner-token')).status, 403);
  assert.equal((await ctx.request('POST', '', 'guardian-token', pdf, 'application/pdf')).status, 200);
  const read = await ctx.request('GET', '', 'guardian-token');
  assert.equal(read.status, 200);
  assert.equal(read.body.receipt.status, 'test_issuer_verified');
  assert.equal(read.body.receipt.requestId, 1);
  assert.equal(read.body.receipt.checks.identity, 'pass');
});

test('malformed and oversized uploads fail before verification', async t => {
  const ctx = await setup(t);
  await ctx.enroll(); ctx.state.status = 1; ctx.state.requestId = 1;
  assert.equal((await ctx.request('POST', '', 'guardian-token', Buffer.from('not a pdf'), 'application/pdf')).status, 400);
  assert.equal((await ctx.request('POST', '', 'guardian-token', Buffer.alloc(10 * 1024 * 1024 + 1, 65), 'application/pdf')).status, 413);
  assert.equal((await ctx.request('GET', '', 'guardian-token')).body.receipt, null);
});

test('verifier timeout and a request changed during verification leave no receipt', async t => {
  const waiting = await setup(t, { verifyPdf: async () => new Promise(() => {}), timeoutMs: 30 });
  await waiting.enroll(); waiting.state.status = 1; waiting.state.requestId = 1;
  assert.equal((await waiting.request('POST', '', 'guardian-token', pdf, 'application/pdf')).status, 504);
  assert.equal((await waiting.request('GET', '', 'guardian-token')).body.receipt, null);
  const stale = await setup(t, { verifyPdf: async () => { stale.state.requestId = 2; return verifierResult(); } });
  await stale.enroll(); stale.state.status = 1; stale.state.requestId = 1;
  assert.equal((await stale.request('POST', '', 'guardian-token', pdf, 'application/pdf')).status, 409);
  assert.equal((await stale.request('GET', '', 'guardian-token')).body.receipt, null);
});

test('concurrent uploads leave one digest-bound receipt without raw claims', async t => {
  const ctx = await setup(t, { verifyPdf: async () => { await new Promise(resolve => setTimeout(resolve, 10)); return verifierResult(); } });
  await ctx.enroll(); ctx.state.status = 1; ctx.state.requestId = 1;
  const otherPdf = Buffer.from('%PDF-1.4\nanother signed certificate\n');
  const [one, two] = await Promise.all([
    ctx.request('POST', '', 'guardian-token', pdf, 'application/pdf'),
    ctx.request('POST', '', 'guardian-token', otherPdf, 'application/pdf')
  ]);
  assert.equal(one.status, 200); assert.equal(two.status, 200);
  const receipt = (await ctx.request('GET', '', 'guardian-token')).body.receipt;
  const hashes = [pdf, otherPdf].map(bytes => createHash('sha256').update(bytes).digest('hex'));
  assert.ok(hashes.includes(receipt.pdfSha256));
  const persisted = readFileSync(ctx.file, 'utf8');
  assert.equal(persisted.includes('Demo Person'), false);
  assert.equal(persisted.includes('DEMO-042'), false);
  assert.equal(persisted.includes('local signed evidence bytes'), false);
  ctx.state.requestId = 2;
  const next = await ctx.request('GET', '', 'guardian-token');
  assert.equal(next.body.receipt, null);
  assert.equal(next.body.historical.requestId, 1);
});
