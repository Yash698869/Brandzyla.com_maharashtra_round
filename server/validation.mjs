import { isAddress, ZeroAddress, ZeroHash } from 'ethers';
import { canonical, digest, keyHash } from '../shared/protocol.mjs';

const check = (condition, message) => { if (!condition) throw new Error(message); };
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const only = (value, keys) => check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => keys.includes(k)), 'Unexpected payload fields');
function base64(value, min, max) { return typeof value === 'string' && value.length >= min && value.length <= max && value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value); }
function publicKey(key) {
  check(key && key.kty === 'RSA' && typeof key.n === 'string' && /^[A-Za-z0-9_-]{342}$/.test(key.n) && key.e === 'AQAB', 'Invalid RSA public identity');
  check(!['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'].some(k => k in key), 'Private key material is forbidden');
}
function binding(b, version) {
  only(b, ['chainId', 'contract', 'vaultId', 'beneficiary', 'beneficiaryKeyHash', ...(version === 2 ? ['backupBeneficiary', 'backupBeneficiaryKeyHash', 'backupWaitingDuration', 'inactivity', 'challenge'] : [])]);
  check(b && Number.isSafeInteger(b.chainId) && b.chainId > 0 && isAddress(b.contract) && isAddress(b.beneficiary) && /^0x[0-9a-fA-F]{64}$/.test(b.vaultId) && /^0x[0-9a-fA-F]{64}$/.test(b.beneficiaryKeyHash), 'Invalid vault binding');
  if (version === 2) {
    check(isAddress(b.backupBeneficiary) && /^0x[0-9a-fA-F]{64}$/.test(b.backupBeneficiaryKeyHash), 'Invalid backup binding');
    check([b.inactivity, b.challenge].every(n => Number.isSafeInteger(n) && n > 0) && Number.isSafeInteger(b.backupWaitingDuration), 'Invalid policy durations');
    if (same(b.backupBeneficiary, ZeroAddress)) check(b.backupWaitingDuration === 0 && same(b.backupBeneficiaryKeyHash, ZeroHash), 'Invalid empty backup policy');
    else check(b.backupWaitingDuration > 0 && !same(b.backupBeneficiary, b.beneficiary) && !same(b.backupBeneficiaryKeyHash, ZeroHash) && !same(b.backupBeneficiaryKeyHash, b.beneficiaryKeyHash), 'Invalid backup policy');
  }
}
function envelope(e) {
  only(e, ['iv', 'wrappedKey', 'ciphertext']);
  check(e && base64(e.iv, 16, 16) && base64(e.wrappedKey, 344, 344) && base64(e.ciphertext, 24, 8192), 'Invalid encrypted share envelope');
}
export function validatePackageShape(p) {
  check(p && [1, 2].includes(p.version), 'Unsupported package version');
  only(p, ['version', 'binding', 'beneficiaryPublicKey', 'iv', 'ciphertext', 'guardianShares', ...(p.version === 2 ? ['backupBeneficiaryPublicKey'] : [])]);
  binding(p.binding, p.version); publicKey(p.beneficiaryPublicKey);
  if (p.version === 2) {
    check(same(keyHash(p.beneficiaryPublicKey), p.binding.beneficiaryKeyHash), 'Beneficiary key commitment mismatch');
    if (!same(p.binding.backupBeneficiary, ZeroAddress)) {
      publicKey(p.backupBeneficiaryPublicKey);
      check(same(keyHash(p.backupBeneficiaryPublicKey), p.binding.backupBeneficiaryKeyHash), 'Backup key commitment mismatch');
    } else check(!p.backupBeneficiaryPublicKey, 'Unexpected backup key');
  }
  check(base64(p.iv, 16, 16) && base64(p.ciphertext, 24, 14000000), 'Invalid or oversized encrypted asset');
  check(Array.isArray(p.guardianShares) && p.guardianShares.length === 3, 'Three guardian envelopes required');
  const guardians = new Set();
  for (const share of p.guardianShares) {
    only(share, ['guardian', 'envelope']);
    check(isAddress(share.guardian), 'Invalid guardian address');
    check(!guardians.has(share.guardian.toLowerCase()), 'Duplicate guardian'); guardians.add(share.guardian.toLowerCase()); envelope(share.envelope);
  }
  return true;
}
export function validateReleaseContext(r, p, chain) {
  validatePackageShape(p); check(r && r.version === p.version, 'Unsupported release');
  only(r, ['version', 'binding', 'guardian', 'requestId', 'envelope', ...(r.version === 2 ? ['recipient'] : [])]);
  binding(r.binding, r.version); envelope(r.envelope);
  check(Number.isSafeInteger(r.requestId) && r.requestId > 0 && r.requestId === Number(chain.requestId), 'Stale request');
  check(canonical(r.binding) === canonical(p.binding), 'Vault binding mismatch');
  check(Number(chain.status) === 2, 'Recovery is not finalized');
  check(same(r.binding.beneficiary, chain.beneficiary) && same(r.binding.beneficiaryKeyHash, chain.beneficiaryKeyHash), 'Beneficiary identity mismatch');
  if (p.version === 2) {
    validateRegistration(p, chain);
    check(isAddress(r.recipient) && same(r.recipient, chain.selectedBeneficiary), 'Wrong selected recipient');
    check(same(r.recipient, chain.beneficiary) || same(r.recipient, chain.backupBeneficiary) && !same(r.recipient, ZeroAddress), 'Unauthorized recipient');
  } else {
    check(Number(chain.policyVersion ?? 1) === 1, 'Legacy package cannot authorize succession');
    check(!chain.selectedBeneficiary || same(chain.selectedBeneficiary, chain.beneficiary), 'Wrong selected recipient');
  }
  check(chain.guardians.some(g => same(g, r.guardian)) && chain.approved.some(g => same(g, r.guardian)), 'Guardian did not approve this request');
  return true;
}
export function validateRegistration(p, vault) {
  validatePackageShape(p);
  check(p.version === Number(vault.policyVersion ?? 1), 'Package and policy version mismatch');
  check(same(digest(p), vault.commitment), 'Encrypted package commitment mismatch');
  check(same(keyHash(p.beneficiaryPublicKey), vault.beneficiaryKeyHash) && same(p.binding.beneficiaryKeyHash, vault.beneficiaryKeyHash), 'Beneficiary key commitment mismatch');
  check(same(p.binding.beneficiary, vault.beneficiary), 'Beneficiary mismatch');
  check(p.guardianShares.every(s => vault.guardians.some(g => same(s.guardian, g))), 'Guardian policy mismatch');
  if (p.version === 2) {
    check(same(p.binding.backupBeneficiary, vault.backupBeneficiary) && same(p.binding.backupBeneficiaryKeyHash, vault.backupBeneficiaryKeyHash), 'Backup policy commitment mismatch');
    check(['inactivity', 'challenge', 'backupWaitingDuration'].every(k => p.binding[k] === Number(vault[k])), 'Policy duration mismatch');
  }
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
