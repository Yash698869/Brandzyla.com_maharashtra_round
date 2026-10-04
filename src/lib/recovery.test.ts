import { describe, expect, it, vi } from 'vitest';
import * as registration from './registration';
import { packageCommitment, publicKeyHash } from './crypto';
import type { Config, ProtectedPackage, VaultState } from './types';

const owner = '0x1111111111111111111111111111111111111111';
const beneficiary = '0x2222222222222222222222222222222222222222';
const guardians = [
  '0x3333333333333333333333333333333333333333',
  '0x4444444444444444444444444444444444444444',
  '0x5555555555555555555555555555555555555555',
];
const vault: VaultState = {
  id: '0x' + 'ab'.repeat(32), owner, beneficiary, guardians,
  inactivity: 60, challenge: 30, lastCheckIn: 100, quorumAt: 0,
  finalizedAt: 0, requestId: 0, approvalCount: 0, status: 0,
  commitment: '0x' + 'cd'.repeat(32), beneficiaryKeyHash: '0x' + 'ef'.repeat(32), approved: [],
};

describe('recovery guidance follows the on-chain gates', () => {
  const guidance = (state: VaultState, address: string, now: number, delivered: string[] = []) =>
    (registration as any).recoveryGuidance(state, address, now, delivered);

  it('holds the beneficiary request until inactivity ends and names the remaining wait', () => {
    expect(guidance(vault, beneficiary, 130).action).toBeUndefined();
    expect(guidance(vault, beneficiary, 130)).toMatchObject({ nextActor: 'beneficiary', waitSeconds: 30 });
    expect(guidance(vault, beneficiary, 160).action).toBe('requestRecovery');
    expect(guidance(vault, owner, 130).action).toBe('checkIn');
  });

  it('waits for the second approval and full challenge window before finalization', () => {
    const pending = { ...vault, status: 1, requestId: 1, approvalCount: 1, approved: [guardians[0]] };
    expect(guidance(pending, beneficiary, 190)).toMatchObject({ nextActor: 'guardian', approvalsNeeded: 1 });
    expect(guidance(pending, guardians[1], 190).action).toBe('approveRecovery');
    expect(guidance(pending, guardians[0], 190).action).toBeUndefined();
    const quorum = { ...pending, approvalCount: 2, approved: guardians.slice(0, 2), quorumAt: 200 };
    expect(guidance(quorum, beneficiary, 215)).toMatchObject({ nextActor: 'beneficiary', waitSeconds: 15 });
    expect(guidance(quorum, beneficiary, 215).action).toBeUndefined();
    expect(guidance(quorum, beneficiary, 230).action).toBe('finalizeRecovery');
    expect(guidance(quorum, owner, 215).action).toBe('checkIn');
  });

  it('allows the last guardian to attest after quorum while beneficiary guidance stays on finalization', () => {
    const quorum = { ...vault, status: 1, requestId: 1, approvalCount: 2, approved: guardians.slice(0, 2), quorumAt: 200 };
    expect(guidance(quorum, guardians[2], 215)).toMatchObject({
      nextActor: 'beneficiary', waitSeconds: 15, action: 'approveRecovery',
    });
    expect(guidance(quorum, guardians[2], 230)).toMatchObject({
      nextActor: 'beneficiary', action: 'approveRecovery',
    });
    expect(guidance(quorum, guardians[0], 215).action).toBeUndefined();
    expect(guidance(quorum, beneficiary, 230).action).toBe('finalizeRecovery');
  });

  it('requires two delivered shares before beneficiary decryption and avoids duplicate guardian release', () => {
    const finalized = { ...vault, status: 2, requestId: 1, approvalCount: 2, approved: guardians.slice(0, 2), quorumAt: 200, finalizedAt: 230 };
    expect(guidance(finalized, beneficiary, 240, [])).toMatchObject({ nextActor: 'guardian', sharesNeeded: 2 });
    expect(guidance(finalized, beneficiary, 240, []).action).toBeUndefined();
    expect(guidance(finalized, guardians[0], 240, []).action).toBe('release');
    expect(guidance(finalized, guardians[0], 240, [guardians[0]]).action).toBeUndefined();
    expect(guidance(finalized, guardians[2], 240, []).action).toBeUndefined();
    expect(guidance(finalized, beneficiary, 240, guardians.slice(0, 2)).action).toBe('decrypt');
  });

  it('gives the backup its later deadline and reserves an active request for its selected beneficiary', () => {
    const backup = '0x7777777777777777777777777777777777777777';
    const succession = { ...vault, policyVersion: 2, backupBeneficiary: backup, backupWaitingDuration: 120 };
    expect(guidance(succession, backup, 160)).toMatchObject({ waitSeconds: 120 });
    expect(guidance(succession, backup, 279).action).toBeUndefined();
    expect(guidance(succession, backup, 280).action).toBe('requestRecovery');
    const pending = { ...succession, status: 1, requestId: 1, selectedBeneficiary: backup, approvalCount: 2, approved: guardians.slice(0, 2), quorumAt: 280 };
    expect(guidance(pending, guardians[2], 300)).toMatchObject({ action: 'approveRecovery', waitSeconds: 10 });
    expect(guidance(pending, guardians[2], 310).action).toBe('approveRecovery');
    expect(guidance(pending, beneficiary, 400).action).toBeUndefined();
    expect(guidance(pending, backup, 309).action).toBeUndefined();
    expect(guidance(pending, backup, 310).action).toBe('finalizeRecovery');
    expect(guidance({ ...pending, status: 2 }, beneficiary, 400, guardians.slice(0, 2)).action).toBeUndefined();
    expect(guidance({ ...pending, status: 2 }, backup, 400, guardians.slice(0, 2)).action).toBe('decrypt');
  });
});

describe('recovery kits', () => {
  const config = { chainId: 31337, contractAddress: '0x6666666666666666666666666666666666666666' } as Config;
  const value = {
    version: 1, binding: { chainId: 31337, contract: config.contractAddress.toLowerCase(), vaultId: vault.id, beneficiary, beneficiaryKeyHash: vault.beneficiaryKeyHash },
    beneficiaryPublicKey: { kty: 'RSA', n: 'example', e: 'AQAB' }, iv: 'a', ciphertext: 'b',
    guardianShares: guardians.map(guardian => ({ guardian, envelope: { iv: 'c', wrappedKey: 'd', ciphertext: 'e' } })),
  } as ProtectedPackage;
  const build = (registration as any).buildRecoveryKit;
  const parse = (registration as any).parseRecoveryKit;

  it('carries vault labels through export and import without changing encrypted package bytes', () => {
    const kit = build(value, { label: 'Family letter', category: 'Family memories', createdAt: 1234 });
    expect(parse(kit, config)).toEqual({ package: value, metadata: { label: 'Family letter', category: 'Family memories', createdAt: 1234 } });
  });

  it('rejects malformed and wrong-chain kits with clear errors', () => {
    expect(() => parse({ format: 'heirloom-recovery-kit', version: 1 }, config)).toThrow(/invalid recovery kit/i);
    expect(() => parse(build(value, { label: 'Family letter', category: 'Family memories', createdAt: 1234 }), { ...config, chainId: 11155111 })).toThrow(/another chain or contract/i);
  });

  it('distinguishes an unmined vault from an unavailable chain during kit import', () => {
    const missing = (registration as any).isVaultNotFound;
    expect(missing({ revert: { name: 'VaultNotFound' } })).toBe(true);
    expect(missing(new Error('network connection lost'))).toBe(false);
  });

  it('blocks a relay kit whose bytes differ from the registered on-chain package', () => {
    const state = { ...vault, commitment: packageCommitment(value), beneficiaryKeyHash: publicKeyHash(value.beneficiaryPublicKey) };
    expect(() => (registration as any).verifyRegisteredKit(build(value), config, state)).not.toThrow();
    expect(() => (registration as any).verifyRegisteredKit(build({ ...value, ciphertext: 'replaced encrypted bytes' }), config, state)).toThrow(/commitment/i);
  });

  it('starts a browser download while its link is attached and keeps the blob alive past the click', async () => {
    vi.useFakeTimers();
    const kit = build(value, { label: 'Family letter', category: 'Family memories', createdAt: 1234 });
    let attached = false, clicked = false, blob: Blob | undefined;
    const anchor = { href: '', download: '', style: { display: '' }, click: () => { expect(attached).toBe(true); clicked = true; }, remove: () => { attached = false; } };
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation(value => { blob = value as Blob; return 'blob:recovery-kit'; });
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild: () => { attached = true; } } });
    try {
      (registration as any).downloadRecoveryKit(kit, 'heirloom-kit.json');
      expect(clicked).toBe(true);
      expect(anchor.download).toBe('heirloom-kit.json');
      expect(JSON.parse(await blob!.text())).toEqual(kit);
      expect(revokeObjectURL).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000);
      expect(revokeObjectURL).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60000);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:recovery-kit');
    } finally { createObjectURL.mockRestore(); revokeObjectURL.mockRestore(); vi.unstubAllGlobals(); vi.useRealTimers(); }
  });
});
