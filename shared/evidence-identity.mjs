const encoder = new TextEncoder();
const HEX_32 = /^[0-9a-fA-F]{64}$/;
const HASH_32 = /^0x[0-9a-fA-F]{64}$/;

function cleanName(value) {
  if (typeof value !== 'string') throw new Error('Legal name is required');
  const name = value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
  if (!name) throw new Error('Legal name is required');
  return name;
}

function cleanIdentifier(value) {
  if (typeof value !== 'string') throw new Error('Identifier is required');
  const identifier = value.normalize('NFKC').trim().replace(/[\s-]+/gu, '').toUpperCase();
  if (!identifier) throw new Error('Identifier is required');
  return identifier;
}

export function canonicalEvidenceIdentity(name, identifier) {
  return JSON.stringify([cleanName(name), cleanIdentifier(identifier)]);
}

export async function evidenceCommitment(name, identifier, saltHex) {
  if (typeof saltHex !== 'string' || !HEX_32.test(saltHex)) throw new Error('Identity salt must be 32 random bytes');
  const material = `heirloom-evidence-identity-v1\n${canonicalEvidenceIdentity(name, identifier)}`;
  const key = await crypto.subtle.importKey('raw', encoder.encode(material), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(saltHex.match(/../g), pair => Number.parseInt(pair, 16));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 210_000, hash: 'SHA-256' }, key, 256);
  return `0x${Array.from(new Uint8Array(bits), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function evidenceEnrollmentMessage(config, vaultId, owner, commitment, saltHex) {
  if (!Number.isInteger(config?.chainId) || !/^0x[0-9a-fA-F]{40}$/.test(config?.contractAddress ?? '') ||
      !HASH_32.test(config?.deploymentId ?? '') || !HASH_32.test(vaultId ?? '') ||
      !/^0x[0-9a-fA-F]{40}$/.test(owner ?? '') || !HASH_32.test(commitment ?? '') ||
      !HEX_32.test(saltHex ?? '')) throw new Error('Invalid evidence enrollment context');
  return [
    'Heirloom evidence identity enrollment v1',
    `chain:${config.chainId}`,
    `contract:${config.contractAddress.toLowerCase()}`,
    `deployment:${config.deploymentId.toLowerCase()}`,
    `vault:${vaultId.toLowerCase()}`,
    `owner:${owner.toLowerCase()}`,
    `commitment:${commitment.toLowerCase()}`,
    `salt:${saltHex.toLowerCase()}`
  ].join('\n');
}
