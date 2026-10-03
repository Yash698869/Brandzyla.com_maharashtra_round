import { split, combine } from 'shamir-secret-sharing';
import { canonical, digest, keyHash } from '../../shared/protocol.mjs';
import type { Identity, Binding, Envelope, ProtectedPackage, ShareRelease, AssetData } from './types';

const encode = (value: unknown) => new TextEncoder().encode(canonical(value));
const base64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(s); };
const unbase64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const context = (binding: Binding, purpose: string, extra: object = {}) => ({ protocol: 'heirloom-v1', binding, purpose, ...extra });

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
export async function sealAsset(bytes: Uint8Array, metadata: { name: string; mime: string }, guardians: { address: string; publicKey: JsonWebKey }[], binding: Binding, beneficiaryPublicKey: JsonWebKey): Promise<ProtectedPackage> {
  if (guardians.length !== 3 || new Set(guardians.map(g => g.address.toLowerCase())).size !== 3) throw new Error('Three distinct guardians required');
  if (keyHash(beneficiaryPublicKey) !== binding.beneficiaryKeyHash) throw new Error('Beneficiary identity mismatch');
  if (bytes.length > 5 * 1024 * 1024) throw new Error('The prototype supports assets up to 5 MB');
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encode(context(binding, 'asset')) }, key, encode({ ...metadata, bytes: base64(bytes) }));
  const shares = await split(raw, 3, 2); raw.fill(0);
  const guardianShares = await Promise.all(guardians.map(async (g, i) => {
    const guardian = g.address.toLowerCase();
    const envelope = await encryptEnvelope({ share: base64(shares[i]), bindingHash: digest(binding), guardian }, g.publicKey, context(binding, 'guardian-share', { guardian }));
    shares[i].fill(0); return { guardian, envelope };
  }));
  return { version: 1, binding, beneficiaryPublicKey, iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)), guardianShares };
}
export async function releaseShare(p: ProtectedPackage, guardianAddress: string, identity: Identity, beneficiaryKey: JsonWebKey, requestId: number): Promise<ShareRelease> {
  if (!Number.isSafeInteger(requestId) || requestId < 1) throw new Error('Invalid request identifier');
  if (keyHash(beneficiaryKey) !== p.binding.beneficiaryKeyHash) throw new Error('Beneficiary identity mismatch');
  const guardian = guardianAddress.toLowerCase(), entry = p.guardianShares.find(s => same(s.guardian, guardian));
  if (!entry) throw new Error('Guardian package missing');
  const share = await decryptEnvelope(entry.envelope, identity, context(p.binding, 'guardian-share', { guardian }));
  if (share.bindingHash !== digest(p.binding) || share.guardian !== guardian) throw new Error('Share binding mismatch');
  const envelope = await encryptEnvelope(share, beneficiaryKey, context(p.binding, 'release', { guardian, requestId }));
  return { version: 1, binding: p.binding, guardian, requestId, envelope };
}
export async function recoverAsset(p: ProtectedPackage, releases: ShareRelease[], identity: Identity, requestId: number): Promise<AssetData> {
  if (releases.length < 2) throw new Error('Two independent guardian shares are required for quorum');
  if (keyHash(identity.publicKey) !== p.binding.beneficiaryKeyHash) throw new Error('Wrong beneficiary identity');
  const guardians = new Set<string>(), indices = new Set<number>(), shares: Uint8Array[] = [];
  for (const release of releases) {
    const guardian = release.guardian.toLowerCase();
    if (guardians.has(guardian)) throw new Error('Duplicate guardian release'); guardians.add(guardian);
    if (release.requestId !== requestId || digest(release.binding) !== digest(p.binding)) throw new Error('Vault or request binding mismatch');
    if (!p.guardianShares.some(s => same(s.guardian, guardian))) throw new Error('Unknown guardian');
    const payload = await decryptEnvelope(release.envelope, identity, context(p.binding, 'release', { guardian, requestId }));
    if (payload.bindingHash !== digest(p.binding) || payload.guardian !== guardian) throw new Error('Share binding mismatch');
    const share = unbase64(payload.share);
    if (share.length !== 33 || indices.has(share[32])) throw new Error('Invalid or duplicate share index'); indices.add(share[32]); shares.push(share);
  }
  const raw = await combine(shares);
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']); raw.fill(0); shares.forEach(s => s.fill(0));
  const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64(p.iv), additionalData: encode(context(p.binding, 'asset')) }, key, unbase64(p.ciphertext));
  const result = JSON.parse(new TextDecoder().decode(clear));
  return { name: result.name, mime: result.mime, bytes: unbase64(result.bytes) };
}
