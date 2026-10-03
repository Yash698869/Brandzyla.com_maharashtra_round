import type { Config, ProtectedPackage, VaultState } from './types';
import { packageCommitment, publicKeyHash } from './crypto';
import { isBeneficiary, selectedRecipient, beneficiaryDeadline } from './workspace-policy';

export interface PendingRegistration { package: ProtectedPackage; label: string; category: string; createdAt: number; transactionHash?: string }
export async function registerWithRecovery(entry: PendingRegistration, persist: (entry: PendingRegistration) => Promise<void>, send: () => Promise<{ hash: string; wait: (confirmations: number, timeout: number) => Promise<unknown> }>, publish: () => Promise<void>, clear: () => Promise<void>): Promise<void> {
  await persist(entry);
  const tx = await send();
  await persist({ ...entry, transactionHash: tx.hash });
  await tx.wait(1, 90000);
  await publish();
  await clear();
}

export async function reconcilePendingRegistration<T extends { id: string; commitment: string }>(
  entry: PendingRegistration,
  loadVault: () => Promise<T>,
  publish: () => Promise<void>,
  complete: (state: T) => Promise<void>,
): Promise<'unmined' | 'mismatch' | 'published'> {
  let state: T;
  try { state = await loadVault(); }
  catch (error) { if (isVaultNotFound(error)) return 'unmined'; throw error; }
  if (packageCommitment(entry.package) !== state.commitment) return 'mismatch';
  await publish();
  await complete(state);
  return 'published';
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export type RecoveryAction = 'checkIn' | 'requestRecovery' | 'approveRecovery' | 'finalizeRecovery' | 'release' | 'decrypt';
export interface RecoveryGuidance {
  nextActor: 'beneficiary' | 'guardian';
  nextAction: string;
  actorMessage: string;
  action?: RecoveryAction;
  waitSeconds?: number;
  approvalsNeeded?: number;
  sharesNeeded?: number;
}

export function recoveryGuidance(state: VaultState, actorAddress: string | undefined, now: number, deliveredGuardians: string[]): RecoveryGuidance {
  const actor = actorAddress ?? '';
  const owner = same(actor, state.owner), beneficiary = isBeneficiary(state, actor);
  const selected = same(actor, selectedRecipient(state));
  const guardian = state.guardians.some(address => same(address, actor));
  const approved = state.approved.some(address => same(address, actor));
  const delivered = deliveredGuardians.some(address => same(address, actor));
  const deliveryCount = state.approved.filter(address => deliveredGuardians.some(sent => same(sent, address))).length;
  let result: RecoveryGuidance;
  if (state.status === 0) {
    const waitSeconds = Math.max(0, beneficiaryDeadline(state, beneficiary ? actor : state.beneficiary) - now);
    result = waitSeconds
      ? { nextActor: 'beneficiary', nextAction: 'Request recovery after the beneficiary eligibility deadline', actorMessage: 'The inactivity or backup waiting period is still open.', waitSeconds }
      : { nextActor: 'beneficiary', nextAction: 'Request recovery', actorMessage: 'The beneficiary can open a recovery request.' };
    if (beneficiary && !waitSeconds) result.action = 'requestRecovery';
  } else if (state.status === 1 && state.approvalCount < 2) {
    result = { nextActor: 'guardian', nextAction: 'Guardian attestation', actorMessage: 'Waiting for independent guardian approvals.', approvalsNeeded: 2 - state.approvalCount };
    if (guardian && !approved) { result.action = 'approveRecovery'; result.actorMessage = 'Verify the owner’s unavailability independently before attesting.'; }
  } else if (state.status === 1) {
    const waitSeconds = Math.max(0, state.quorumAt + state.challenge - now);
    result = waitSeconds
      ? { nextActor: 'beneficiary', nextAction: 'Finalize after the owner cancellation window', actorMessage: 'The owner can still cancel this recovery.', waitSeconds }
      : { nextActor: 'beneficiary', nextAction: 'Finalize recovery', actorMessage: 'The cancellation window has ended.' };
    if (selected && !waitSeconds) result.action = 'finalizeRecovery';
  } else if (deliveryCount < 2) {
    result = { nextActor: 'guardian', nextAction: 'Deliver encrypted key shares', actorMessage: 'Waiting for approved guardians to deliver encrypted shares.', sharesNeeded: 2 - deliveryCount };
    if (guardian && approved && !delivered) { result.action = 'release'; result.actorMessage = 'Your approved share can be encrypted for the beneficiary.'; }
  } else {
    result = { nextActor: 'beneficiary', nextAction: 'Decrypt the inherited asset', actorMessage: 'Two encrypted shares are ready for local decryption.' };
    if (selected) result.action = 'decrypt';
  }
  if (owner && state.status !== 2) {
    result.action = 'checkIn';
    result.actorMessage = state.status === 1 ? 'Your check-in will cancel this recovery request.' : 'Check in to reset the inactivity period.';
  }
  if (!actor) result.actorMessage = 'Connect a wallet or select a demo actor to see your action.';
  else if (!owner && !beneficiary && !guardian) result.actorMessage = 'This account has no action for this vault.';
  else if (beneficiary && state.status !== 0 && !selected) result.actorMessage = 'This request belongs to the other beneficiary. Only its selected recipient can finalize or decrypt.';
  return result;
}

export interface RecoveryKitMetadata { label: string; category: string; createdAt: number }
export interface RecoveryKit { format: 'heirloom-recovery-kit'; version: 1; package: ProtectedPackage; metadata?: RecoveryKitMetadata; transactionHash?: string }
export function buildRecoveryKit(p: ProtectedPackage, metadata?: RecoveryKitMetadata, transactionHash?: string): RecoveryKit {
  return { format: 'heirloom-recovery-kit', version: 1, package: p, ...(metadata ? { metadata } : {}), ...(transactionHash ? { transactionHash } : {}) };
}
function record(value: unknown): value is Record<string, any> { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function parseRecoveryKit(value: unknown, config: Config): { package: ProtectedPackage; metadata?: RecoveryKitMetadata; transactionHash?: string } {
  if (!record(value) || value.format !== 'heirloom-recovery-kit' || value.version !== 1) throw new Error('Unsupported recovery kit');
  const p = value.package;
  if (!record(p) || ![1, 2].includes(p.version) || !record(p.binding) || !record(p.beneficiaryPublicKey) ||
      typeof p.iv !== 'string' || typeof p.ciphertext !== 'string' || !Array.isArray(p.guardianShares) || p.guardianShares.length !== 3 ||
      !p.guardianShares.every((share: unknown) => record(share) && typeof share.guardian === 'string' && record(share.envelope) &&
        typeof share.envelope.iv === 'string' && typeof share.envelope.wrappedKey === 'string' && typeof share.envelope.ciphertext === 'string') ||
      typeof p.binding.chainId !== 'number' || typeof p.binding.contract !== 'string' || typeof p.binding.vaultId !== 'string' ||
      typeof p.binding.beneficiary !== 'string' || typeof p.binding.beneficiaryKeyHash !== 'string') throw new Error('Invalid recovery kit package');
  if (p.binding.chainId !== config.chainId || !same(p.binding.contract, config.contractAddress)) throw new Error('This recovery kit belongs to another chain or contract');
  if (p.version === 2 && (typeof p.binding.backupBeneficiary !== 'string' || typeof p.binding.backupBeneficiaryKeyHash !== 'string' ||
    ![p.binding.inactivity, p.binding.challenge].every(n => Number.isSafeInteger(n) && n > 0) || !Number.isSafeInteger(p.binding.backupWaitingDuration))) throw new Error('Invalid succession recovery kit package');
  let metadata: RecoveryKitMetadata | undefined;
  if (record(value.metadata) && typeof value.metadata.label === 'string' && typeof value.metadata.category === 'string' &&
      Number.isSafeInteger(value.metadata.createdAt) && value.metadata.label.length <= 70 && value.metadata.category.length <= 70) {
    metadata = { label: value.metadata.label, category: value.metadata.category, createdAt: value.metadata.createdAt };
  }
  return { package: p as ProtectedPackage, ...(metadata ? { metadata } : {}), ...(typeof value.transactionHash === 'string' ? { transactionHash: value.transactionHash } : {}) };
}

export function verifyRegisteredKit(value: unknown, config: Config, state: VaultState): RecoveryKit {
  const kit = parseRecoveryKit(value, config);
  if (!same(kit.package.binding.vaultId, state.id) || packageCommitment(kit.package) !== state.commitment ||
      publicKeyHash(kit.package.beneficiaryPublicKey) !== state.beneficiaryKeyHash) {
    throw new Error('Recovery kit does not match its on-chain commitments');
  }
  const p = kit.package, b = p.binding;
  if (p.version !== (state.policyVersion ?? 1) || !same(b.beneficiary, state.beneficiary) ||
    new Set(p.guardianShares.map(s => s.guardian.toLowerCase())).size !== 3 ||
    !p.guardianShares.every(s => state.guardians.some(g => same(g, s.guardian)))) throw new Error('Recovery kit policy mismatch');
  if (p.version === 2 && (!same(b.backupBeneficiary ?? '', state.backupBeneficiary ?? '') ||
    !same(b.backupBeneficiaryKeyHash ?? '', state.backupBeneficiaryKeyHash ?? '') ||
    b.inactivity !== state.inactivity || b.challenge !== state.challenge || b.backupWaitingDuration !== state.backupWaitingDuration ||
    (p.backupBeneficiaryPublicKey && publicKeyHash(p.backupBeneficiaryPublicKey) !== state.backupBeneficiaryKeyHash))) throw new Error('Recovery kit backup commitments mismatch');
  return value as RecoveryKit;
}

export function isVaultNotFound(error: unknown): boolean {
  if (!record(error)) return false;
  return error.revert?.name === 'VaultNotFound' || [error.reason, error.shortMessage, error.message].some(part => typeof part === 'string' && part.includes('VaultNotFound'));
}

export function downloadRecoveryKit(kit: RecoveryKit, filename: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(kit, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  try { anchor.click(); }
  catch (error) { URL.revokeObjectURL(url); throw error; }
  finally { anchor.remove(); }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
