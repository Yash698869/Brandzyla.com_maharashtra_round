import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyMessage } from 'ethers';
import { evidenceCommitment, evidenceEnrollmentMessage } from '../shared/evidence-identity.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VAULT_ID = /^0x[0-9a-fA-F]{64}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const SALT = /^[0-9a-fA-F]{64}$/;
const CHECK_NAMES = ['signature', 'coverage', 'chain', 'revocation', 'issuer', 'fields'];
const CHECK_VALUES = new Set(['pass', 'fail', 'indeterminate']);

class EvidenceError extends Error {
  constructor(status, code) { super(code); this.status = status; }
}

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

export async function runPdfVerifier(path, profileId, signal) {
  const executable = process.env.HEIRLOOM_PYTHON || 'python';
  const testProfile = process.env.HEIRLOOM_TEST_EVIDENCE_PROFILE || join(projectRoot, '.runtime', 'evidence-demo', 'profile.json');
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, ['-m', 'verifier.verify_pdf', '--input', path, '--profile', profileId], {
      cwd: projectRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], signal,
      env: { ...process.env, HEIRLOOM_TEST_EVIDENCE_PROFILE: testProfile }
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.length > 131_072) child.kill();
    });
    child.once('error', reject);
    child.once('close', code => {
      if (code !== 0 || output.length > 131_072) return reject(new Error('verifier_unavailable'));
      try { resolveResult(JSON.parse(output)); }
      catch { reject(new Error('verifier_unavailable')); }
    });
  });
}

function safeChecks(raw) {
  const checks = {};
  for (const name of CHECK_NAMES) checks[name] = CHECK_VALUES.has(raw?.[name]) ? raw[name] : 'indeterminate';
  return checks;
}

function receiptStatus(checks, identity, profileId) {
  const core = ['signature', 'coverage', 'chain', 'revocation'];
  if ([...CHECK_NAMES.map(name => checks[name]), identity].includes('fail')) return 'failed';
  if (core.every(name => checks[name] === 'pass') && checks.issuer !== 'pass') return 'signed_issuer_unverified';
  if (CHECK_NAMES.every(name => checks[name] === 'pass') && identity === 'pass' && profileId === 'test-local') return 'test_issuer_verified';
  return 'indeterminate';
}

export function createEvidenceHandlers({ storage, config, vaultState, verifyPdf = runPdfVerifier, timeoutMs = 20_000 }) {
  const locks = new Map();

  async function actor(req) {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new EvidenceError(401, 'authentication_required');
    const session = await storage.getSession(token);
    if (!session || Date.now() >= session.expiresAt) throw new EvidenceError(401, 'session_expired');
    if (session.isDemo) {
      const demo = config.actors?.find(value => same(value.address, session.actorAddress));
      if (!demo) throw new EvidenceError(401, 'session_invalid');
      return demo.address;
    }
    const user = await storage.getUserByEmail(session.email);
    if (!user || user.id !== session.userId) throw new EvidenceError(401, 'session_invalid');
    return user.address;
  }

  async function context(req) {
    const id = req.params.vaultId;
    if (!VAULT_ID.test(id || '')) throw new EvidenceError(400, 'invalid_vault_id');
    const address = await actor(req);
    const state = await vaultState(id);
    if (!state?.owner) throw new EvidenceError(404, 'vault_not_found');
    return { id: id.toLowerCase(), address, state };
  }

  function guardianOnly(address, state) {
    if (!state.guardians?.some(value => same(value, address))) throw new EvidenceError(403, 'guardian_required');
  }

  async function enroll(req, res) {
    const { id, address, state } = await context(req);
    if (!same(address, state.owner)) throw new EvidenceError(403, 'owner_required');
    if (Number(state.status) !== 0 || Number(state.requestId) !== 0) throw new EvidenceError(409, 'enrollment_closed');
    const body = req.body || {};
    if (Object.keys(body).sort().join(',') !== 'commitment,owner,saltHex,signature' ||
        !same(body.owner, state.owner) || !HASH.test(body.commitment || '') || !SALT.test(body.saltHex || '') ||
        typeof body.signature !== 'string') throw new EvidenceError(400, 'invalid_enrollment');
    try {
      const message = evidenceEnrollmentMessage(config, id, state.owner, body.commitment, body.saltHex);
      if (!same(verifyMessage(message, body.signature), state.owner)) throw new Error('wrong signer');
    } catch { throw new EvidenceError(403, 'invalid_owner_signature'); }
    const prior = await storage.getEvidenceEnrollment(id);
    const record = {
      vaultId: id, owner: state.owner.toLowerCase(), commitment: body.commitment.toLowerCase(),
      saltHex: body.saltHex.toLowerCase(), signature: body.signature,
      createdAt: prior?.createdAt ?? Date.now()
    };
    try { await storage.saveEvidenceEnrollment(id, record); }
    catch { throw new EvidenceError(409, 'enrollment_immutable'); }
    res.json({ enrolled: true, vaultId: id });
  }

  async function getEnrollment(req, res) {
    const { id, address, state } = await context(req);
    if (!same(address, state.owner) && !state.guardians?.some(value => same(value, address))) {
      throw new EvidenceError(403, 'vault_role_required');
    }
    res.json({ enrolled: Boolean(await storage.getEvidenceEnrollment(id)), vaultId: id });
  }

  async function locked(key, fn) {
    const previous = locks.get(key) || Promise.resolve();
    let unlock;
    const current = new Promise(resolveLock => { unlock = resolveLock; });
    locks.set(key, current);
    await previous;
    try { return await fn(); }
    finally { unlock(); if (locks.get(key) === current) locks.delete(key); }
  }

  async function verifyWithTimeout(path, profileId) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        verifyPdf(path, profileId, controller.signal),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new EvidenceError(504, 'verifier_timeout')); }, timeoutMs); })
      ]);
    } finally { clearTimeout(timer); }
  }

  async function upload(req, res) {
    const { id, address, state } = await context(req);
    guardianOnly(address, state);
    if (Number(state.status) !== 1 || Number(state.requestId) < 1) throw new EvidenceError(409, 'recovery_not_pending');
    if (!Buffer.isBuffer(req.body) || req.body.length < 8 || req.body.length > 10 * 1024 * 1024 ||
        req.body.subarray(0, 5).toString() !== '%PDF-') throw new EvidenceError(400, 'invalid_pdf');
    const requestId = Number(state.requestId);
    const bytes = req.body;
    const key = `${id}:${requestId}`;
    const receipt = await locked(key, async () => {
      const temp = await mkdtemp(join(tmpdir(), 'heirloom-evidence-'));
      const path = join(temp, 'evidence.pdf');
      try {
        await writeFile(path, bytes, { mode: 0o600 });
        const profileId = process.env.HEIRLOOM_EVIDENCE_PROFILE || 'test-local';
        let raw;
        try { raw = await verifyWithTimeout(path, profileId); }
        catch (error) {
          if (error instanceof EvidenceError) throw error;
          throw new EvidenceError(503, 'verifier_unavailable');
        }
        const latest = await vaultState(id);
        if (Number(latest.status) !== 1 || Number(latest.requestId) !== requestId) throw new EvidenceError(409, 'stale_recovery_request');
        const checks = safeChecks(raw);
        const enrollment = await storage.getEvidenceEnrollment(id);
        let identity = 'indeterminate';
        const reasonCodes = Array.isArray(raw?.reasonCodes)
          ? raw.reasonCodes.filter(value => typeof value === 'string' && /^[a-z_]{1,48}$/.test(value)).slice(0, 12)
          : [];
        if (!enrollment) reasonCodes.push('missing_enrollment');
        else if (CHECK_NAMES.every(name => checks[name] === 'pass') && raw?.claims?.name && raw?.claims?.identifier) {
          const candidate = await evidenceCommitment(raw.claims.name, raw.claims.identifier, enrollment.saltHex);
          identity = candidate === enrollment.commitment ? 'pass' : 'fail';
          if (identity === 'fail') reasonCodes.push('identity_mismatch');
        }
        const result = {
          vaultId: id, requestId, pdfSha256: createHash('sha256').update(bytes).digest('hex'),
          status: receiptStatus(checks, identity, profileId),
          checks: { ...checks, identity },
          signerFingerprint: /^[0-9a-f]{64}$/i.test(raw?.signerFingerprint || '') ? raw.signerFingerprint.toLowerCase() : null,
          issuerLabel: profileId === 'test-local' ? 'Heirloom local test issuer' : 'Unconfigured issuer',
          reasonCodes: [...new Set(reasonCodes)], verifiedAt: Date.now()
        };
        await storage.saveEvidenceReceipt(id, requestId, result);
        return result;
      } finally { await rm(temp, { recursive: true, force: true }); }
    });
    res.json({ receipt });
  }

  async function getCurrentReceipt(req, res) {
    const { id, address, state } = await context(req);
    guardianOnly(address, state);
    const requestId = Number(state.requestId);
    const active = Number(state.status) === 1 || Number(state.status) === 2;
    const receipt = active && requestId > 0 ? await storage.getEvidenceReceipt(id, requestId) : null;
    const historicalId = active ? requestId - 1 : requestId;
    const historical = historicalId > 0 ? await storage.getEvidenceReceipt(id, historicalId) : null;
    res.json({ receipt, historical });
  }

  return { enroll, getEnrollment, upload, getCurrentReceipt };
}
