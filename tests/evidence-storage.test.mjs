import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newDb } from 'pg-mem';
import { initStorage } from '../server/storage.mjs';

const vaultId = `0x${'AA'.repeat(32)}`;
const enrollment = {
  vaultId: vaultId.toLowerCase(),
  owner: `0x${'bb'.repeat(20)}`,
  commitment: `0x${'cc'.repeat(32)}`,
  saltHex: '11'.repeat(32),
  signature: `0x${'dd'.repeat(65)}`,
  createdAt: 1234567
};
const receipt = {
  vaultId: vaultId.toLowerCase(),
  requestId: 1,
  pdfSha256: 'ee'.repeat(32),
  status: 'test_issuer_verified',
  checks: { signature: 'pass', coverage: 'pass' }
};

async function exerciseStorage(storage) {
  assert.equal(await storage.getEvidenceEnrollment(vaultId), null);
  await storage.saveEvidenceEnrollment(vaultId, enrollment);
  assert.deepEqual(await storage.getEvidenceEnrollment(vaultId.toLowerCase()), enrollment);
  await storage.saveEvidenceEnrollment(vaultId, {
    createdAt: enrollment.createdAt,
    signature: enrollment.signature,
    saltHex: enrollment.saltHex,
    commitment: enrollment.commitment,
    owner: enrollment.owner,
    vaultId: enrollment.vaultId
  });
  await assert.rejects(
    storage.saveEvidenceEnrollment(vaultId, { ...enrollment, commitment: `0x${'ff'.repeat(32)}` }),
    /already enrolled|immutable|conflict/i
  );
  assert.equal(JSON.stringify(await storage.getEvidenceEnrollment(vaultId)).includes('Demo Person'), false);
  assert.equal(await storage.getEvidenceReceipt(vaultId, 2), null);
  await storage.saveEvidenceReceipt(vaultId, 1, receipt);
  assert.deepEqual(await storage.getEvidenceReceipt(vaultId.toLowerCase(), 1), receipt);
  assert.equal(await storage.getEvidenceReceipt(vaultId, 2), null);
  await storage.saveEvidenceReceipt(vaultId, 2, { ...receipt, requestId: 2, status: 'failed' });
  assert.equal((await storage.getEvidenceReceipt(vaultId, 1)).status, 'test_issuer_verified');
  assert.equal((await storage.getEvidenceReceipt(vaultId, 2)).status, 'failed');
}

test('file storage keeps immutable enrollment and request-scoped receipts through reload', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'heirloom-evidence-storage-'));
  try {
    const file = join(dir, 'relay.json');
    const storage = await initStorage({ file, databaseUrl: '' });
    await exerciseStorage(storage);
    const reopened = await initStorage({ file, databaseUrl: '' });
    assert.deepEqual(await reopened.getEvidenceEnrollment(vaultId), enrollment);
    assert.deepEqual(await reopened.getEvidenceReceipt(vaultId, 1), receipt);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PostgreSQL storage keeps immutable enrollment and request-scoped receipts', async () => {
  const db = newDb();
  const Pool = db.adapters.createPg().Pool;
  const storage = await initStorage({ pool: new Pool() });
  try { await exerciseStorage(storage); }
  finally { await storage.close(); }
});
