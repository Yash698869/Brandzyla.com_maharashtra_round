import { test } from 'node:test';
import assert from 'node:assert/strict';
import { id, ZeroAddress, ZeroHash } from 'ethers';
import { digest, keyHash } from '../shared/protocol.mjs';
import { validatePackageShape, validateReleaseContext, validateRecoveryKit, validateIdentity, validateRegistration } from '../server/validation.mjs';

const a = n => `0x${String(n).repeat(40)}`;
const key = { kty: 'RSA', n: 'A'.repeat(342), e: 'AQAB', alg: 'RSA-OAEP-256', ext: true, key_ops: ['encrypt'] };
const envelope = { iv: Buffer.alloc(12).toString('base64'), wrappedKey: Buffer.alloc(256).toString('base64'), ciphertext: Buffer.alloc(80).toString('base64') };
const binding = { chainId: 31337, contract: a(1), vaultId: id('vault'), beneficiary: a(2), beneficiaryKeyHash: id('key') };
function pkg() { return { version: 1, binding, beneficiaryPublicKey: key, iv: Buffer.alloc(12).toString('base64'), ciphertext: Buffer.alloc(90).toString('base64'), guardianShares: [3, 4, 5].map(n => ({ guardian: a(n), envelope })) }; }
function release() { return { version: 1, binding, guardian: a(3), requestId: 1, envelope }; }
const chain = { ...binding, status: 2, requestId: 1, guardians: [a(3), a(4), a(5)], approved: [a(3), a(4)] };

test('accepts a valid encrypted package and rejects malformed/oversized payloads', () => {
  assert.equal(validatePackageShape(pkg()), true);
  for (const change of [p => p.version = 2, p => p.iv = 'bad', p => p.ciphertext = 'A'.repeat(15000000), p => p.guardianShares[1].guardian = a(3), p => p.binding.vaultId = '../../escape', p => p.beneficiaryPublicKey.d = 'private']) {
    const p = structuredClone(pkg()); change(p); assert.throws(() => validatePackageShape(p));
  }
});
test('release is bound to finalized state, approved guardian, beneficiary and current request', () => {
  assert.equal(validateReleaseContext(release(), pkg(), chain), true);
  for (const change of [r => r.requestId = 2, r => r.guardian = a(5), r => r.binding.contract = a(9), r => r.binding.beneficiary = a(9), r => r.binding.vaultId = id('other')]) {
    const r = structuredClone(release()); change(r); assert.throws(() => validateReleaseContext(r, pkg(), chain));
  }
  assert.throws(() => validateReleaseContext(release(), pkg(), { ...chain, status: 1 }));
});
test('recovery kit rejects wrong chain, deployment, commitment and beneficiary identity', () => {
  const p = pkg(); const config = { chainId: 31337, contractAddress: a(1) };
  const kit = { format: 'heirloom-recovery-kit', version: 1, package: p };
  assert.equal(validateRecoveryKit(kit, config), true);
  assert.throws(() => validateRecoveryKit(kit, { ...config, chainId: 11155111 }));
  assert.throws(() => validateRecoveryKit(kit, { ...config, contractAddress: a(9) }));
  assert.throws(() => validateRecoveryKit({ ...kit, format: 'unknown' }, config));
});
test('identity rejects private key fields and conflicting enrollment', () => {
  const identity = { address: a(3), publicKey: key };
  assert.equal(validateIdentity(identity), true);
  assert.throws(() => validateIdentity({ ...identity, publicKey: { ...key, d: 'private' } }));
  assert.throws(() => validateIdentity({ ...identity, publicKey: { ...key, n: 'short' } }));
  assert.throws(() => validateIdentity(identity, { ...identity, publicKey: { ...key, n: 'B'.repeat(342) } }));
});

function succession() {
  const backupKey = { ...key, n: 'B'.repeat(342) };
  const b = { ...binding, beneficiaryKeyHash: keyHash(key), backupBeneficiary: a(6), backupBeneficiaryKeyHash: keyHash(backupKey), inactivity: 60, challenge: 30, backupWaitingDuration: 120 };
  const p = { ...pkg(), version: 2, binding: b, backupBeneficiaryPublicKey: backupKey };
  const v = { ...chain, ...b, commitment: digest(p), policyVersion: 2, selectedBeneficiary: a(6) };
  const r = { ...release(), version: 2, binding: b, recipient: a(6) };
  return { p, v, r };
}

test('succession releases require the finalized selected recipient and committed backup identity', () => {
  const { p, v, r } = succession();
  assert.equal(validateRegistration(p, v), true);
  assert.equal(validateReleaseContext(r, p, v), true);
  for (const change of [r => r.recipient = a(2), r => r.recipient = a(9), r => r.version = 1, r => r.requestId++, r => r.guardian = a(5), r => r.binding.vaultId = id('other')]) {
    const altered = structuredClone(r); change(altered);
    assert.throws(() => validateReleaseContext(altered, p, v));
  }
  assert.throws(() => validateReleaseContext(r, p, { ...v, status: 0 }));
  assert.throws(() => validateReleaseContext(r, p, { ...v, status: 1 }));
  assert.throws(() => validateRegistration(p, { ...v, backupBeneficiaryKeyHash: id('wrong') }));
  assert.throws(() => validateRegistration(p, { ...v, backupWaitingDuration: 121 }));
  assert.throws(() => validateRegistration(p, { ...v, policyVersion: 1 }));
  const primary = { ...r, recipient: a(2) };
  assert.equal(validateReleaseContext(primary, p, { ...v, selectedBeneficiary: a(2) }), true);
});

test('version handling is explicit and optional backup has a consistent empty policy', () => {
  const { p, v } = succession();
  assert.throws(() => validatePackageShape({ ...p, version: 3 }));
  assert.throws(() => validatePackageShape({ ...p, backupBeneficiaryPublicKey: p.beneficiaryPublicKey }));
  const absent = { ...p, binding: { ...p.binding, backupBeneficiary: ZeroAddress, backupBeneficiaryKeyHash: ZeroHash, backupWaitingDuration: 0 } };
  delete absent.backupBeneficiaryPublicKey;
  assert.equal(validatePackageShape(absent), true);
  assert.throws(() => validatePackageShape({ ...absent, binding: { ...absent.binding, backupWaitingDuration: 1 } }));
  assert.throws(() => validateRegistration(pkg(), { ...v, commitment: digest(pkg()) }));
  const legacy = { ...pkg(), binding: { ...binding, beneficiaryKeyHash: keyHash(key) } };
  assert.equal(validateRegistration(legacy, { ...chain, commitment: digest(legacy), beneficiaryKeyHash: keyHash(key), policyVersion: 1, backupBeneficiary: ZeroAddress }), true);
});

test('relay rejects plaintext or private material smuggled into encrypted payloads', () => {
  const { p, v, r } = succession();
  for (const altered of [{ ...p, aesKey: 'plaintext' }, { ...p, document: 'plaintext' }, { ...p, binding: { ...p.binding, share: 'plaintext' } }]) assert.throws(() => validatePackageShape(altered));
  assert.throws(() => validateReleaseContext({ ...r, share: 'plaintext' }, p, v));
  assert.throws(() => validateReleaseContext({ ...r, envelope: { ...r.envelope, privateKey: 'plaintext' } }, p, v));
});
