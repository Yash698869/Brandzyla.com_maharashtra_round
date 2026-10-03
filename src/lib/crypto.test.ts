import { describe, it, expect, beforeAll } from 'vitest';
import * as cryptoModule from './crypto';
import { id } from 'ethers';

const { createIdentity, sealAsset, releaseShare, recoverAsset, packageCommitment, publicKeyHash } = cryptoModule;
const addresses = ['0x1111111111111111111111111111111111111111', '0x2222222222222222222222222222222222222222', '0x3333333333333333333333333333333333333333'];
let identities: Awaited<ReturnType<typeof createIdentity>>[];
let beneficiary: Awaited<ReturnType<typeof createIdentity>>;
let binding: Parameters<typeof sealAsset>[3];
const bytes = new TextEncoder().encode('For my family: the things that matter live on. 🌱');
beforeAll(async () => {
  identities = await Promise.all(addresses.map(() => createIdentity())); beneficiary = await createIdentity();
  binding = { chainId: 31337, contract: '0x4444444444444444444444444444444444444444', vaultId: id('vault one'), beneficiary: '0x5555555555555555555555555555555555555555', beneficiaryKeyHash: publicKeyHash(beneficiary.publicKey) };
});
async function sealed() { return sealAsset(bytes, { name: 'family.txt', mime: 'text/plain' }, identities.map((identity, i) => ({ address: addresses[i], publicKey: identity.publicKey })), binding, beneficiary.publicKey); }
async function releases(p: Awaited<ReturnType<typeof sealed>>, indices = [0, 2], requestId = 1) {
  return Promise.all(indices.map(i => releaseShare(p, addresses[i], identities[i], beneficiary.publicKey, requestId)));
}
describe('encrypted inheritance', () => {
  it('recovers exact bytes with any two guardians and keeps names encrypted', async () => {
    for (const indices of [[0, 1], [0, 2], [1, 2]]) {
      const p = await sealed(); const result = await recoverAsset(p, await releases(p, indices), beneficiary, 1);
      expect(result.name).toBe('family.txt'); expect(result.bytes).toEqual(bytes);
      expect(JSON.stringify(p)).not.toContain('family.txt'); expect(JSON.stringify(p)).not.toContain('the things that matter');
    }
  });
  it('rejects one guardian and duplicate guardians', async () => {
    const p = await sealed(), r = await releases(p);
    await expect(recoverAsset(p, [r[0]], beneficiary, 1)).rejects.toThrow(/two|quorum/i);
    await expect(recoverAsset(p, [r[0], r[0]], beneficiary, 1)).rejects.toThrow(/duplicate/i);
  });
  it('rejects a guardian using another private key and the wrong beneficiary', async () => {
    const p = await sealed();
    await expect(releaseShare(p, addresses[0], identities[1], beneficiary.publicKey, 1)).rejects.toThrow();
    await expect(recoverAsset(p, await releases(p), identities[0], 1)).rejects.toThrow();
    await expect(releaseShare(p, addresses[0], identities[0], identities[1].publicKey, 1)).rejects.toThrow(/beneficiary/i);
  });
  it('detects ciphertext tampering', async () => {
    const p = await sealed(), r = await releases(p); const modified = structuredClone(p);
    modified.ciphertext = (modified.ciphertext[0] === 'A' ? 'B' : 'A') + modified.ciphertext.slice(1);
    await expect(recoverAsset(modified, r, beneficiary, 1)).rejects.toThrow();
    expect(packageCommitment(modified)).not.toBe(packageCommitment(p));
  });
  it('rejects stale request envelopes and mixed-vault releases', async () => {
    const p = await sealed(), r = await releases(p);
    await expect(recoverAsset(p, r, beneficiary, 2)).rejects.toThrow(/request|binding/i);
    const other = await sealAsset(bytes, { name: 'other.txt', mime: 'text/plain' }, identities.map((identity, i) => ({ address: addresses[i], publicKey: identity.publicKey })), { ...binding, vaultId: id('other vault') }, beneficiary.publicKey);
    await expect(recoverAsset(other, r, beneficiary, 1)).rejects.toThrow(/binding|vault/i);
  });
  it('rejects release tampering and duplicate share indices', async () => {
    const p = await sealed(), r = await releases(p);
    const modified = structuredClone(r); modified[0].envelope.iv = 'AAAAAAAAAAAAAAAA';
    await expect(recoverAsset(p, modified, beneficiary, 1)).rejects.toThrow();
    const same = { ...r[0], guardian: addresses[1] };
    await expect(recoverAsset(p, [r[0], same], beneficiary, 1)).rejects.toThrow();
  });
});
