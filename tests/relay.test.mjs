import { test } from 'node:test';
import assert from 'node:assert/strict';
import { id } from 'ethers';
import { validatePackageShape, validateReleaseContext, validateRecoveryKit, validateIdentity } from '../server/validation.mjs';

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
