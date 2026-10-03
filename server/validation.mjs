import { isAddress } from 'ethers';
import { canonical, digest, keyHash } from '../shared/protocol.mjs';

const check = (condition, message) => { if (!condition) throw new Error(message); };
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
function base64(value, min, max) { return typeof value === 'string' && value.length >= min && value.length <= max && value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value); }
function publicKey(key) {
  check(key && key.kty === 'RSA' && typeof key.n === 'string' && /^[A-Za-z0-9_-]{342}$/.test(key.n) && key.e === 'AQAB', 'Invalid RSA public identity');
  check(!['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'].some(k => k in key), 'Private key material is forbidden');
}
function binding(b) {
  check(b && Number.isSafeInteger(b.chainId) && b.chainId > 0 && isAddress(b.contract) && isAddress(b.beneficiary) && /^0x[0-9a-fA-F]{64}$/.test(b.vaultId) && /^0x[0-9a-fA-F]{64}$/.test(b.beneficiaryKeyHash), 'Invalid vault binding');
}
function envelope(e) {
  check(e && base64(e.iv, 16, 16) && base64(e.wrappedKey, 344, 344) && base64(e.ciphertext, 24, 8192), 'Invalid encrypted share envelope');
}
export function validatePackageShape(p) {
  check(p && p.version === 1, 'Unsupported package version'); binding(p.binding); publicKey(p.beneficiaryPublicKey);
  check(base64(p.iv, 16, 16) && base64(p.ciphertext, 24, 14000000), 'Invalid or oversized encrypted asset');
  check(Array.isArray(p.guardianShares) && p.guardianShares.length === 3, 'Three guardian envelopes required');
  const guardians = new Set();
  for (const share of p.guardianShares) {
    check(isAddress(share.guardian), 'Invalid guardian address');
    check(!guardians.has(share.guardian.toLowerCase()), 'Duplicate guardian'); guardians.add(share.guardian.toLowerCase()); envelope(share.envelope);
  }
  return true;
}
export function validateReleaseContext(r, p, chain) {
  validatePackageShape(p); check(r && r.version === 1, 'Unsupported release'); binding(r.binding); envelope(r.envelope);
  check(Number.isSafeInteger(r.requestId) && r.requestId > 0 && r.requestId === Number(chain.requestId), 'Stale request');
  check(canonical(r.binding) === canonical(p.binding), 'Vault binding mismatch');
  check(Number(chain.status) === 2, 'Recovery is not finalized');
  check(same(r.binding.beneficiary, chain.beneficiary) && same(r.binding.beneficiaryKeyHash, chain.beneficiaryKeyHash), 'Beneficiary identity mismatch');
  check(chain.guardians.some(g => same(g, r.guardian)) && chain.approved.some(g => same(g, r.guardian)), 'Guardian did not approve this request');
  return true;
}
export function validateRegistration(p, vault) {
  validatePackageShape(p);
  check(same(digest(p), vault.commitment), 'Encrypted package commitment mismatch');
  check(same(keyHash(p.beneficiaryPublicKey), vault.beneficiaryKeyHash) && same(p.binding.beneficiaryKeyHash, vault.beneficiaryKeyHash), 'Beneficiary key commitment mismatch');
  check(same(p.binding.beneficiary, vault.beneficiary), 'Beneficiary mismatch');
  check(p.guardianShares.every(s => vault.guardians.some(g => same(s.guardian, g))), 'Guardian policy mismatch');
  return true;
}
export function validateRecoveryKit(kit, config) {
  check(kit && kit.format === 'heirloom-recovery-kit' && kit.version === 1, 'Unsupported recovery kit'); validatePackageShape(kit.package);
  check(kit.package.binding.chainId === config.chainId && same(kit.package.binding.contract, config.contractAddress), 'Recovery kit belongs to another deployment');
  return true;
}
export function validateIdentity(identity, existing) {
  check(identity && isAddress(identity.address), 'Invalid identity account'); publicKey(identity.publicKey);
  if (existing) check(keyHash(existing.publicKey) === keyHash(identity.publicKey), 'A different encryption identity is already enrolled for this account');
  return true;
}
