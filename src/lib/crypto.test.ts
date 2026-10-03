import { describe, it, expect, beforeAll } from 'vitest';
import * as cryptoModule from './crypto';
import { id } from 'ethers';
import { canonical } from '../../shared/protocol.mjs';
import type { Identity, ShareRelease } from './types';

const { createIdentity, sealAsset, releaseShare, recoverAsset, packageCommitment, publicKeyHash } = cryptoModule;
const addresses = ['0x1111111111111111111111111111111111111111', '0x2222222222222222222222222222222222222222', '0x3333333333333333333333333333333333333333'];
let identities: Awaited<ReturnType<typeof createIdentity>>[];
let beneficiary: Awaited<ReturnType<typeof createIdentity>>;
let backup: Awaited<ReturnType<typeof createIdentity>>;
let binding: Parameters<typeof sealAsset>[3];
const bytes = new TextEncoder().encode('For my family: the things that matter live on. 🌱');
const fromBase64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const toBase64 = (value: Uint8Array) => btoa(String.fromCharCode(...value));
const releaseAad = (r: ShareRelease) => ({ protocol: `heirloom-v${r.version}`, binding: r.binding, purpose: 'release', guardian: r.guardian, requestId: r.requestId, ...(r.version === 2 ? { recipient: r.recipient } : {}) });
async function readRelease(r: ShareRelease, identity: Identity, aad: unknown = releaseAad(r)) {
  const raw = await crypto.subtle.decrypt('RSA-OAEP', identity.privateKey, fromBase64(r.envelope.wrappedKey));
  const aes = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(r.envelope.iv), additionalData: new TextEncoder().encode(canonical(aad)) }, aes, fromBase64(r.envelope.ciphertext));
  return JSON.parse(new TextDecoder().decode(clear)) as { share: string; bindingHash: string; guardian: string };
}
async function rewriteRelease(r: ShareRelease, identity: Identity, payload: unknown, aad: unknown = releaseAad(r)): Promise<ShareRelease> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const aes = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const rsa = await crypto.subtle.importKey('jwk', identity.publicKey, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(canonical(aad)) }, aes, new TextEncoder().encode(canonical(payload)));
  const wrapped = await crypto.subtle.encrypt('RSA-OAEP', rsa, raw);
  return { ...r, envelope: { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)), wrappedKey: toBase64(new Uint8Array(wrapped)) } };
}
beforeAll(async () => {
  identities = await Promise.all(addresses.map(() => createIdentity())); beneficiary = await createIdentity(); backup = await createIdentity();
  binding = { chainId: 31337, contract: '0x4444444444444444444444444444444444444444', vaultId: id('vault one'), beneficiary: '0x5555555555555555555555555555555555555555', beneficiaryKeyHash: publicKeyHash(beneficiary.publicKey) };
});

describe('v2 recipient-bound succession encryption', () => {
  const backupAddress = '0x6666666666666666666666666666666666666666';
  const binary = Uint8Array.from({ length: 256 }, (_, i) => i);
  const guardians = () => identities.map((identity, i) => ({ address: addresses[i], publicKey: identity.publicKey }));
  const policy = () => ({ ...binding, backupBeneficiary: backupAddress, backupBeneficiaryKeyHash: publicKeyHash(backup.publicKey), backupWaitingDuration: 30, inactivity: 60, challenge: 10 });
  const seal = () => sealAsset(binary, { name: 'binary.dat', mime: 'application/octet-stream' }, guardians(), policy(), beneficiary.publicKey, backup.publicKey);
  const release = (p: Awaited<ReturnType<typeof seal>>, recipient = binding.beneficiary, identity = beneficiary, requestId = 3) => Promise.all([0, 2].map(i => releaseShare(p, addresses[i], identities[i], identity.publicKey, requestId, recipient)));

  it('recovers exact binary bytes for either independently bound recipient', async () => {
    const p = await seal();
    expect(p.version).toBe(2);
    expect(p.backupBeneficiaryPublicKey).toEqual(backup.publicKey);
    for (const [recipient, identity] of [[binding.beneficiary, beneficiary], [backupAddress, backup]] as const) {
      const r = await release(p, recipient, identity);
      expect(r.every(item => item.version === 2 && item.recipient === recipient.toLowerCase())).toBe(true);
      const recovered = await recoverAsset(p, r, identity, 3, recipient);
      expect(recovered.bytes).toEqual(binary);
      expect(recovered.name).toBe('binary.dat');
      expect(recovered.mime).toBe('application/octet-stream');
    }
    expect(JSON.stringify(p)).not.toContain('binary.dat');
  });

  it('requires an explicit allowed recipient and its committed identity', async () => {
    const p = await seal(), primaryReleases = await release(p);
    await expect(releaseShare(p, addresses[0], identities[0], beneficiary.publicKey, 3)).rejects.toThrow(/recipient/i);
    await expect(recoverAsset(p, primaryReleases, beneficiary, 3)).rejects.toThrow(/recipient/i);
    await expect(release(p, addresses[0], beneficiary)).rejects.toThrow(/recipient/i);
    await expect(release(p, backupAddress, beneficiary)).rejects.toThrow(/identity/i);
    await expect(release(p, binding.beneficiary, backup)).rejects.toThrow(/identity/i);
    await expect(recoverAsset(p, primaryReleases, backup, 3, binding.beneficiary)).rejects.toThrow(/identity/i);
    await expect(recoverAsset(p, primaryReleases, backup, 3, backupAddress)).rejects.toThrow(/recipient/i);
    const backupReleases = await release(p, backupAddress, backup);
    await expect(recoverAsset(p, backupReleases, beneficiary, 3, binding.beneficiary)).rejects.toThrow(/recipient/i);
  });

  it('rejects the same primary and backup key or uncommitted backup keys', async () => {
    await expect(sealAsset(binary, { name: 'x', mime: 'x' }, guardians(), { ...policy(), backupBeneficiaryKeyHash: binding.beneficiaryKeyHash }, beneficiary.publicKey, beneficiary.publicKey)).rejects.toThrow(/distinct|same/i);
    await expect(sealAsset(binary, { name: 'x', mime: 'x' }, guardians(), policy(), beneficiary.publicKey, identities[0].publicKey)).rejects.toThrow(/backup.*identity/i);
    await expect(sealAsset(binary, { name: 'x', mime: 'x' }, guardians(), policy(), beneficiary.publicKey)).rejects.toThrow(/backup.*identity/i);
  });

  it('uses v2 with disabled backup represented by zero address, hash, and wait', async () => {
    const p = await sealAsset(binary, { name: 'x', mime: 'x' }, guardians(), { ...binding, inactivity: 60, challenge: 10 }, beneficiary.publicKey);
    expect(p.version).toBe(2);
    expect(p.binding.backupBeneficiary).toBe('0x' + '0'.repeat(40));
    expect(p.binding.backupBeneficiaryKeyHash).toBe('0x' + '0'.repeat(64));
    expect(p.binding.backupWaitingDuration).toBe(0);
    expect(p.backupBeneficiaryPublicKey).toBeUndefined();
    expect((await recoverAsset(p, await release(p), beneficiary, 3, binding.beneficiary)).bytes).toEqual(binary);
    await expect(release(p, '0x' + '0'.repeat(40), backup)).rejects.toThrow(/recipient/i);
  });

  it('rejects stale requests, mixed vaults, duplicate guardians, and mixed versions', async () => {
    const p = await seal(), r = await release(p);
    await expect(recoverAsset(p, r, beneficiary, 4, binding.beneficiary)).rejects.toThrow(/request|binding/i);
    await expect(recoverAsset(p, [r[0], r[0]], beneficiary, 3, binding.beneficiary)).rejects.toThrow(/duplicate/i);
    const other = await sealAsset(binary, { name: 'x', mime: 'x' }, guardians(), { ...policy(), vaultId: id('another v2 vault') }, beneficiary.publicKey, backup.publicKey);
    await expect(recoverAsset(other, r, beneficiary, 3, binding.beneficiary)).rejects.toThrow(/vault|binding/i);
    await expect(recoverAsset(p, [{ ...r[0], version: 1 }, r[1]], beneficiary, 3, binding.beneficiary)).rejects.toThrow(/version/i);
    const legacy = await sealed(), legacyReleases = await releases(legacy);
    await expect(recoverAsset(legacy, [{ ...legacyReleases[0], version: 2 }, legacyReleases[1]], beneficiary, 1)).rejects.toThrow(/version/i);
  });

  it('authenticates recipient, guardian, request, binding, and ciphertext', async () => {
    const p = await seal(), r = await release(p);
    const mutations = [
      { ...r[0], recipient: backupAddress },
      { ...r[0], guardian: addresses[1] },
      { ...r[0], requestId: 4 },
      { ...r[0], binding: { ...p.binding, chainId: 1 } },
      { ...r[0], envelope: { ...r[0].envelope, iv: 'AAAAAAAAAAAAAAAA' } },
    ];
    for (const changed of mutations) await expect(recoverAsset(p, [changed, r[1]], beneficiary, 3, binding.beneficiary)).rejects.toThrow();
    const changed = structuredClone(p);
    changed.ciphertext = (p.ciphertext[0] === 'A' ? 'B' : 'A') + p.ciphertext.slice(1);
    await expect(recoverAsset(changed, r, beneficiary, 3, binding.beneficiary)).rejects.toThrow();
    expect(packageCommitment(changed)).not.toBe(packageCommitment(p));
    const changedPolicy = { ...p, binding: { ...p.binding, backupWaitingDuration: 31 } };
    await expect(release(changedPolicy)).rejects.toThrow();
    const changedKey = { ...p, backupBeneficiaryPublicKey: identities[0].publicKey };
    expect(packageCommitment(changedKey)).not.toBe(packageCommitment(p));
    await expect(release(changedKey)).rejects.toThrow(/identity/i);
  });

  it('deliberately retains v1 round trips without recipient arguments', async () => {
    const legacy = await sealed();
    expect(legacy.version).toBe(1);
    const r = await releases(legacy);
    expect(r.every(item => item.version === 1 && item.recipient === undefined)).toBe(true);
    expect((await recoverAsset(legacy, r, beneficiary, 1)).bytes).toEqual(bytes);
    expect((await readRelease(r[0], beneficiary)).guardian).toBe(addresses[0]);
    await expect(readRelease(r[0], beneficiary, { ...releaseAad(r[0]), protocol: 'heirloom-v2' })).rejects.toThrow();
  });

  it('rejects duplicate share indices even in valid authenticated guardian envelopes', async () => {
    const p = await seal(), r = await release(p);
    const first = await readRelease(r[0], beneficiary), second = await readRelease(r[1], beneficiary);
    const forged = await rewriteRelease(r[1], beneficiary, { ...second, share: first.share });
    await expect(recoverAsset(p, [r[0], forged], beneficiary, 3, binding.beneficiary)).rejects.toThrow(/duplicate share index/i);
  });

  it('cryptographically authenticates the v2 recipient and protocol, beyond release metadata', async () => {
    const p = await seal(), r = await release(p), payload = await readRelease(r[0], beneficiary);
    for (const aad of [{ ...releaseAad(r[0]), recipient: backupAddress }, { ...releaseAad(r[0]), protocol: 'heirloom-v1' }]) {
      const forged = await rewriteRelease(r[0], beneficiary, payload, aad);
      await expect(recoverAsset(p, [forged, r[1]], beneficiary, 3, binding.beneficiary)).rejects.toThrow();
    }
  });
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
