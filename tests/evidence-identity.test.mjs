import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, verifyMessage } from 'ethers';
import {
  canonicalEvidenceIdentity,
  evidenceCommitment,
  evidenceEnrollmentMessage
} from '../shared/evidence-identity.mjs';

const salt = '11'.repeat(32);
const config = {
  chainId: 31337,
  contractAddress: `0x${'22'.repeat(20)}`,
  deploymentId: `0x${'33'.repeat(32)}`
};
const vaultId = `0x${'44'.repeat(32)}`;

test('identity canonicalization normalizes spacing and certificate identifier formatting', () => {
  assert.equal(canonicalEvidenceIdentity('  Demo   Person  ', ' demo - 042 '), '["demo person","DEMO042"]');
});

test('PBKDF2 commitment matches an independently derived fixed vector', async () => {
  assert.equal(
    await evidenceCommitment('  Demo   Person ', 'DEMO-042', salt),
    '0x5e4c860f4b3c6285e3facc7b41bcdb1dc5c4baa9bb0789e041a5bce89a4885fb'
  );
  assert.equal(
    await evidenceCommitment('Demo Person', 'DEMO-043', salt) ===
      await evidenceCommitment('Demo Person', 'DEMO-042', salt),
    false
  );
});

test('enrollment rejects short, nonhex, or empty identity fields', async () => {
  await assert.rejects(evidenceCommitment('Demo Person', 'DEMO-042', '11'), /salt/i);
  await assert.rejects(evidenceCommitment('Demo Person', 'DEMO-042', 'zz'.repeat(32)), /salt/i);
  await assert.rejects(evidenceCommitment('', 'DEMO-042', salt), /name/i);
  await assert.rejects(evidenceCommitment('Demo Person', '', salt), /identifier/i);
});

test('owner signature is bound to deployment, contract, vault, and commitment', async () => {
  const wallet = Wallet.createRandom();
  const commitment = await evidenceCommitment('Demo Person', 'DEMO-042', salt);
  const message = evidenceEnrollmentMessage(config, vaultId, wallet.address, commitment, salt);
  const signature = await wallet.signMessage(message);
  assert.equal(verifyMessage(message, signature), wallet.address);
  assert.notEqual(evidenceEnrollmentMessage({ ...config, deploymentId: `0x${'55'.repeat(32)}` }, vaultId, wallet.address, commitment, salt), message);
  assert.notEqual(evidenceEnrollmentMessage({ ...config, contractAddress: `0x${'66'.repeat(20)}` }, vaultId, wallet.address, commitment, salt), message);
  assert.notEqual(evidenceEnrollmentMessage(config, `0x${'77'.repeat(32)}`, wallet.address, commitment, salt), message);
  assert.notEqual(evidenceEnrollmentMessage(config, vaultId, wallet.address, `0x${'88'.repeat(32)}`, salt), message);
  assert.equal(message.includes('Demo Person'), false);
  assert.equal(message.includes('DEMO-042'), false);
});
