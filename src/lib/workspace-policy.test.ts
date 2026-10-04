import { describe, expect, it } from 'vitest';
import type { VaultState } from './types';
import { backupRecipient, beneficiaryDeadline, canFinalize, canRequest, isBeneficiary, selectedRecipient } from './workspace-policy';

const primary = '0x1111111111111111111111111111111111111111';
const backup = '0x2222222222222222222222222222222222222222';
const state = (overrides: Partial<VaultState> = {}): VaultState => ({
  id: 'vault', owner: 'owner', beneficiary: primary, guardians: ['g1', 'g2', 'g3'],
  inactivity: 60, challenge: 30, lastCheckIn: 100, quorumAt: 0, finalizedAt: 0,
  requestId: 1, approvalCount: 0, status: 0, commitment: 'commitment', beneficiaryKeyHash: 'hash', approved: [],
  policyVersion: 2, backupBeneficiary: backup, backupWaitingDuration: 120, ...overrides,
});

describe('confirmed workspace recovery policy', () => {
  it('opens primary at inactivity and backup only after its additional wait', () => {
    const v = state();
    expect(beneficiaryDeadline(v, primary)).toBe(160);
    expect(beneficiaryDeadline(v, backup)).toBe(280);
    expect(canRequest(v, primary, 159)).toBe(false);
    expect(canRequest(v, primary, 160)).toBe(true);
    expect(canRequest(v, backup, 279)).toBe(false);
    expect(canRequest(v, backup, 280)).toBe(true);
    expect(canRequest(v, primary, 280)).toBe(true);
  });

  it('treats legacy and zero-address policies as primary-only', () => {
    expect(backupRecipient(state({ policyVersion: undefined }))).toBeUndefined();
    expect(isBeneficiary(state({ policyVersion: 1 }), backup)).toBe(false);
    expect(backupRecipient(state({ backupBeneficiary: `0x${'0'.repeat(40)}` }))).toBeUndefined();
  });

  it('never displaces an active request even after the backup deadline', () => {
    const v = state({ status: 1, selectedBeneficiary: primary });
    expect(canRequest(v, backup, 1000)).toBe(false);
    expect(canRequest(v, primary, 1000)).toBe(false);
    expect(selectedRecipient(v)).toBe(primary);
  });

  it('allows only selected recipient to finalize at the full challenge boundary', () => {
    const v = state({ status: 1, selectedBeneficiary: backup, approvalCount: 2, quorumAt: 300 });
    expect(canFinalize(v, primary, 330)).toBe(false);
    expect(canFinalize(v, backup, 329)).toBe(false);
    expect(canFinalize(v, backup, 330)).toBe(true);
    expect(canFinalize({ ...v, quorumAt: 0 }, backup, 1000)).toBe(false);
    expect(canFinalize({ ...v, approvalCount: 1 }, backup, 1000)).toBe(false);
  });

  it('falls back to primary for legacy selected recipients and blocks offline controls', () => {
    const v = state({ policyVersion: undefined, selectedBeneficiary: undefined, status: 1, approvalCount: 2, quorumAt: 300 });
    expect(selectedRecipient(v)).toBe(primary);
    expect(canFinalize(v, primary, 330, true)).toBe(false);
    expect(canRequest(state(), backup, 280, true)).toBe(false);
    expect(canRequest(state(), 'unconfigured', 1000)).toBe(false);
    expect(canRequest(state(), backup, 0)).toBe(false);
  });
});
