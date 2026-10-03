import { canonical, keyHash } from '../../shared/protocol.mjs';
import type { Identity } from './types';

export interface BackupContext {
  chainId: number;
  contractAddress: string;
  deploymentId: string;
  address: string;
}

export interface IdentityBackup {
  format: 'heirloom-identity-backup';
  version: 1;
  context: BackupContext;
  publicKey: JsonWebKey;
  publicKeyHash: string;
  kdf: 'PBKDF2-HMAC-SHA-256';
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

const iterations = 600_000;
const encoder = new TextEncoder();
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const encode = (bytes: Uint8Array) => {
  let result = '';
  for (const byte of bytes) result += String.fromCharCode(byte);
  return btoa(result);
};
function decode(value: unknown, length?: number): Uint8Array {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('Malformed identity backup');
  const bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0));
  if (length !== undefined && bytes.length !== length) throw new Error('Malformed identity backup');
  return bytes;
}
function normalizeContext(context: BackupContext): BackupContext {
  if (!Number.isSafeInteger(context?.chainId) || context.chainId < 1 || !addressPattern.test(context.contractAddress) || !hashPattern.test(context.deploymentId) || !addressPattern.test(context.address)) throw new Error('Invalid backup identity or deployment');
  return { chainId: context.chainId, contractAddress: context.contractAddress.toLowerCase(), deploymentId: context.deploymentId.toLowerCase(), address: context.address.toLowerCase() };
}
function header(backup: IdentityBackup) {
  const { ciphertext: _ciphertext, ...headerFields } = backup;
  return headerFields;
}
async function aesKey(passphrase: string, salt: Uint8Array, count: number): Promise<CryptoKey> {
  if (typeof passphrase !== 'string' || !passphrase.length) throw new Error('Enter the identity backup passphrase');
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: count }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function createBackedIdentity(context: BackupContext, passphrase: string): Promise<{ identity: Identity; backup: IdentityBackup }> {
  const normalized = normalizeContext(context);
  if (typeof passphrase !== 'string' || !passphrase.length) throw new Error('Enter the identity backup passphrase');
  const keys = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
  const publicKey = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const backup: IdentityBackup = { format: 'heirloom-identity-backup', version: 1, context: normalized, publicKey, publicKeyHash: keyHash(publicKey), kdf: 'PBKDF2-HMAC-SHA-256', iterations, salt: encode(salt), iv: encode(iv), ciphertext: '' };
  const raw = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
  try {
    const key = await aesKey(passphrase, salt, iterations);
    backup.ciphertext = encode(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(canonical(header(backup))) }, key, raw)));
    const privateKey = await crypto.subtle.importKey('pkcs8', raw, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
    return { identity: { privateKey, publicKey }, backup };
  } finally { raw.fill(0); }
}

export async function restoreBackedIdentity(input: unknown, passphrase: string, expectedContext: BackupContext, enrolledKeyHash?: string): Promise<Identity> {
  if (!input || typeof input !== 'object' || JSON.stringify(input).length > 32_768) throw new Error('Malformed identity backup');
  const backup = input as IdentityBackup;
  if (backup.format !== 'heirloom-identity-backup' || backup.version !== 1 || backup.kdf !== 'PBKDF2-HMAC-SHA-256' || !Number.isSafeInteger(backup.iterations) || backup.iterations < 600_000 || backup.iterations > 1_000_000) throw new Error('Unsupported identity backup parameters');
  const actual = normalizeContext(backup.context), expected = normalizeContext(expectedContext);
  if (canonical(actual) !== canonical(expected)) throw new Error('Identity backup belongs to another wallet or deployment');
  if (!backup.publicKey || keyHash(backup.publicKey) !== backup.publicKeyHash || !hashPattern.test(backup.publicKeyHash) || (enrolledKeyHash && backup.publicKeyHash.toLowerCase() !== enrolledKeyHash.toLowerCase())) throw new Error('Identity backup does not match the enrolled key');
  const salt = decode(backup.salt, 16), iv = decode(backup.iv, 12), ciphertext = decode(backup.ciphertext);
  if (ciphertext.length < 17 || ciphertext.length > 16_384) throw new Error('Malformed identity backup');
  const key = await aesKey(passphrase, salt, backup.iterations);
  let raw: Uint8Array;
  try { raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(canonical(header(backup))) }, key, ciphertext)); }
  catch { throw new Error('Wrong passphrase or damaged identity backup'); }
  try {
    const privateKey = await crypto.subtle.importKey('pkcs8', raw, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
    const publicKey = await crypto.subtle.importKey('jwk', backup.publicKey, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const wrapped = await crypto.subtle.encrypt('RSA-OAEP', publicKey, challenge);
    const unwrapped = new Uint8Array(await crypto.subtle.decrypt('RSA-OAEP', privateKey, wrapped));
    if (unwrapped.length !== challenge.length || unwrapped.some((byte, index) => byte !== challenge[index])) throw new Error('Identity backup key pair mismatch');
    return { privateKey, publicKey: backup.publicKey };
  } finally { raw.fill(0); }
}
