import { split, combine } from 'shamir-secret-sharing';
import { canonical, digest, keyHash } from '../../shared/protocol.mjs';
import type { Identity, Binding, Envelope, ProtectedPackage, ShareRelease, AssetData } from './types';

const encode = (value: unknown) => new TextEncoder().encode(canonical(value));
const base64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(s); };
const unbase64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const context = (binding: Binding, purpose: string, extra: object = {}, version: 1 | 2 = 1) => ({ protocol: `heirloom-v${version}`, binding, purpose, ...extra });
const zeroAddress = '0x' + '0'.repeat(40), zeroHash = '0x' + '0'.repeat(64);
const successionFields = ['backupBeneficiary', 'backupBeneficiaryKeyHash', 'backupWaitingDuration', 'inactivity', 'challenge'] as const;
const hasSuccession = (binding: Binding) => successionFields.some(field => binding[field] !== undefined);

function validateV2Binding(binding: Binding) {
  if (!Number.isSafeInteger(binding.inactivity) || binding.inactivity! <= 0 || !Number.isSafeInteger(binding.challenge) || binding.challenge! <= 0) throw new Error('Invalid succession policy durations');
  if (!binding.backupBeneficiary || !/^0x[0-9a-f]{40}$/i.test(binding.backupBeneficiary) || !binding.backupBeneficiaryKeyHash || !/^0x[0-9a-f]{64}$/i.test(binding.backupBeneficiaryKeyHash)) throw new Error('Invalid backup beneficiary binding');
  if (same(binding.backupBeneficiary, zeroAddress)) {
    if (!same(binding.backupBeneficiaryKeyHash, zeroHash) || binding.backupWaitingDuration !== 0) throw new Error('Disabled backup requires zero identity and waiting duration');
  } else {
    if (same(binding.backupBeneficiary, binding.beneficiary)) throw new Error('Primary and backup beneficiaries must be distinct');
    if (same(binding.backupBeneficiaryKeyHash, zeroHash) || !Number.isSafeInteger(binding.backupWaitingDuration) || binding.backupWaitingDuration! <= 0) throw new Error('Invalid backup beneficiary identity or waiting duration');
    if (same(binding.backupBeneficiaryKeyHash, binding.beneficiaryKeyHash)) throw new Error('Primary and backup identities must use distinct keys');
  }
}

function validatePackage(p: ProtectedPackage) {
  if (p.version !== 1 && p.version !== 2) throw new Error('Unsupported package version');
  if (p.version === 1) return;
  validateV2Binding(p.binding);
  if (!same(keyHash(p.beneficiaryPublicKey), p.binding.beneficiaryKeyHash)) throw new Error('Beneficiary identity mismatch');
  if (!same(p.binding.backupBeneficiary!, zeroAddress)) {
    if (!p.backupBeneficiaryPublicKey || !same(keyHash(p.backupBeneficiaryPublicKey), p.binding.backupBeneficiaryKeyHash!)) throw new Error('Backup beneficiary identity mismatch');
  } else if (p.backupBeneficiaryPublicKey) throw new Error('Disabled backup cannot have a public identity');
}

function recipientBinding(p: ProtectedPackage, recipient?: string): { recipient: string; keyHash: string } {
  if (p.version === 1) return { recipient: p.binding.beneficiary.toLowerCase(), keyHash: p.binding.beneficiaryKeyHash };
  if (!recipient) throw new Error('An explicit release recipient is required');
  if (same(recipient, p.binding.beneficiary)) return { recipient: p.binding.beneficiary.toLowerCase(), keyHash: p.binding.beneficiaryKeyHash };
  if (!same(p.binding.backupBeneficiary!, zeroAddress) && same(recipient, p.binding.backupBeneficiary!)) return { recipient: p.binding.backupBeneficiary!.toLowerCase(), keyHash: p.binding.backupBeneficiaryKeyHash! };
  throw new Error('Recipient is not an allowed beneficiary');
}

export async function createIdentity(): Promise<Identity> {
  const keys = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, false, ['encrypt', 'decrypt']);
  return { privateKey: keys.privateKey, publicKey: await crypto.subtle.exportKey('jwk', keys.publicKey) };
}
export const publicKeyHash = keyHash;
export const packageCommitment = (p: ProtectedPackage) => digest(p);

async function encryptEnvelope(value: unknown, publicKey: JsonWebKey, aad: unknown): Promise<Envelope> {
  const recipient = await crypto.subtle.importKey('jwk', publicKey, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encode(aad) }, key, encode(value));
  const wrappedKey = await crypto.subtle.encrypt('RSA-OAEP', recipient, raw); raw.fill(0);
  return { iv: base64(iv), wrappedKey: base64(new Uint8Array(wrappedKey)), ciphertext: base64(new Uint8Array(ciphertext)) };
}
async function decryptEnvelope(envelope: Envelope, identity: Identity, aad: unknown): Promise<any> {
  const raw = new Uint8Array(await crypto.subtle.decrypt('RSA-OAEP', identity.privateKey, unbase64(envelope.wrappedKey)));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']); raw.fill(0);
  const value = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64(envelope.iv), additionalData: encode(aad) }, key, unbase64(envelope.ciphertext));
  return JSON.parse(new TextDecoder().decode(value));
}
export async function sealAsset(bytes: Uint8Array, metadata: { name: string; mime: string }, guardians: { address: string; publicKey: JsonWebKey }[], binding: Binding, beneficiaryPublicKey: JsonWebKey, backupBeneficiaryPublicKey?: JsonWebKey): Promise<ProtectedPackage> {
  if (guardians.length !== 3 || new Set(guardians.map(g => g.address.toLowerCase())).size !== 3) throw new Error('Three distinct guardians required');
  if (keyHash(beneficiaryPublicKey) !== binding.beneficiaryKeyHash) throw new Error('Beneficiary identity mismatch');
  if (bytes.length > 5 * 1024 * 1024) throw new Error('The prototype supports assets up to 5 MB');
  const version = hasSuccession(binding) ? 2 : 1;
  if (version === 2) {
    binding = { ...binding, backupBeneficiary: binding.backupBeneficiary ?? zeroAddress, backupBeneficiaryKeyHash: binding.backupBeneficiaryKeyHash ?? zeroHash, backupWaitingDuration: binding.backupWaitingDuration ?? 0 };
    validateV2Binding(binding);
    if (!same(binding.backupBeneficiary!, zeroAddress)) {
      if (!backupBeneficiaryPublicKey || !same(keyHash(backupBeneficiaryPublicKey), binding.backupBeneficiaryKeyHash!)) throw new Error('Backup beneficiary identity mismatch');
    } else if (backupBeneficiaryPublicKey) throw new Error('Disabled backup cannot have a public identity');
  } else if (backupBeneficiaryPublicKey) throw new Error('Backup identity requires a succession binding');
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encode(context(binding, 'asset', {}, version)) }, key, encode({ ...metadata, bytes: base64(bytes) }));
  const shares = await split(raw, 3, 2); raw.fill(0);
  const guardianShares = await Promise.all(guardians.map(async (g, i) => {
    const guardian = g.address.toLowerCase();
    const envelope = await encryptEnvelope({ share: base64(shares[i]), bindingHash: digest(binding), guardian }, g.publicKey, context(binding, 'guardian-share', { guardian }, version));
    shares[i].fill(0); return { guardian, envelope };
  }));
  return { version, binding, beneficiaryPublicKey, ...(backupBeneficiaryPublicKey ? { backupBeneficiaryPublicKey } : {}), iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)), guardianShares };
}
// The caller must authorize the finalized request and its selected recipient on chain.
export async function releaseShare(p: ProtectedPackage, guardianAddress: string, identity: Identity, beneficiaryKey: JsonWebKey, requestId: number, recipient?: string): Promise<ShareRelease> {
  if (!Number.isSafeInteger(requestId) || requestId < 1) throw new Error('Invalid request identifier');
  validatePackage(p);
  const selected = recipientBinding(p, recipient);
  if (!same(keyHash(beneficiaryKey), selected.keyHash)) throw new Error('Beneficiary identity mismatch');
  const guardian = guardianAddress.toLowerCase(), entry = p.guardianShares.find(s => same(s.guardian, guardian));
  if (!entry) throw new Error('Guardian package missing');
  const share = await decryptEnvelope(entry.envelope, identity, context(p.binding, 'guardian-share', { guardian }, p.version));
  if (share.bindingHash !== digest(p.binding) || share.guardian !== guardian) throw new Error('Share binding mismatch');
  const recipientContext = p.version === 2 ? { recipient: selected.recipient } : {};
  const envelope = await encryptEnvelope(share, beneficiaryKey, context(p.binding, 'release', { guardian, requestId, ...recipientContext }, p.version));
  return { version: p.version, binding: p.binding, guardian, requestId, ...recipientContext, envelope };
}
export async function recoverAsset(p: ProtectedPackage, releases: ShareRelease[], identity: Identity, requestId: number, recipient?: string): Promise<AssetData> {
  if (releases.length < 2) throw new Error('Two independent guardian shares are required for quorum');
  validatePackage(p);
  const selected = recipientBinding(p, recipient);
  if (!same(keyHash(identity.publicKey), selected.keyHash)) throw new Error('Wrong beneficiary identity');
  const guardians = new Set<string>(), indices = new Set<number>(), shares: Uint8Array[] = [];
  for (const release of releases) {
    if (release.version !== p.version) throw new Error('Release version mismatch');
    if (p.version === 2 && release.recipient !== selected.recipient) throw new Error('Release recipient mismatch');
    const guardian = release.guardian.toLowerCase();
    if (guardians.has(guardian)) throw new Error('Duplicate guardian release'); guardians.add(guardian);
    if (release.requestId !== requestId || digest(release.binding) !== digest(p.binding)) throw new Error('Vault or request binding mismatch');
    if (!p.guardianShares.some(s => same(s.guardian, guardian))) throw new Error('Unknown guardian');
    const recipientContext = p.version === 2 ? { recipient: selected.recipient } : {};
    const payload = await decryptEnvelope(release.envelope, identity, context(p.binding, 'release', { guardian, requestId, ...recipientContext }, p.version));
    if (payload.bindingHash !== digest(p.binding) || payload.guardian !== guardian) throw new Error('Share binding mismatch');
    const share = unbase64(payload.share);
    if (share.length !== 33 || indices.has(share[32])) throw new Error('Invalid or duplicate share index'); indices.add(share[32]); shares.push(share);
  }
  const raw = await combine(shares);
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']); raw.fill(0); shares.forEach(s => s.fill(0));
  const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64(p.iv), additionalData: encode(context(p.binding, 'asset', {}, p.version)) }, key, unbase64(p.ciphertext));
  const result = JSON.parse(new TextDecoder().decode(clear));
  return { name: result.name, mime: result.mime, bytes: unbase64(result.bytes) };
}
