import type { VaultState } from './types';

const same = (a = '', b = '') => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function backupRecipient(state: VaultState): string | undefined {
  return state.policyVersion === 2 && state.backupBeneficiary && !/^0x0{40}$/i.test(state.backupBeneficiary)
    ? state.backupBeneficiary : undefined;
}

export function isBeneficiary(state: VaultState, account: string): boolean {
  return same(state.beneficiary, account) || same(backupRecipient(state), account);
}

export function selectedRecipient(state: VaultState): string {
  return state.selectedBeneficiary ?? state.beneficiary;
}

export function beneficiaryDeadline(state: VaultState, account: string): number {
  if (!isBeneficiary(state, account)) return Infinity;
  return state.lastCheckIn + state.inactivity + (same(backupRecipient(state), account) ? state.backupWaitingDuration ?? 0 : 0);
}

export function canRequest(state: VaultState, account: string, confirmedTime: number, offline = false): boolean {
  return !offline && confirmedTime > 0 && state.status === 0 && confirmedTime >= beneficiaryDeadline(state, account);
}

export function canFinalize(state: VaultState, account: string, confirmedTime: number, offline = false): boolean {
  return !offline && confirmedTime > 0 && state.status === 1 && same(selectedRecipient(state), account)
    && state.approvalCount >= 2 && state.quorumAt > 0 && confirmedTime >= state.quorumAt + state.challenge;
}

export function policyDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
