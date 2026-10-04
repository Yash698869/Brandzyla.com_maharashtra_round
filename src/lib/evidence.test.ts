import { describe, expect, it } from 'vitest';
import { Wallet, verifyMessage } from 'ethers';
import type { Config, EvidenceReceipt, EvidenceStatus, Vault } from './types';
import { canEnrollEvidence, evidenceStatusLabel, isCurrentEvidenceReceipt, prepareEvidenceEnrollment, validateEvidenceFile } from './evidence';

const owner = `0x${'11'.repeat(20)}`;
const vaultId = `0x${'44'.repeat(32)}`;
const config: Config = { chainId: 31337, contractAddress: `0x${'22'.repeat(20)}`, deploymentId: `0x${'33'.repeat(32)}`,
  rpcUrl: 'http://127.0.0.1:8545', abi: [], deploymentBlock: 1, codeHash: 'code', mode: 'local', confirmations: 1, actors: [] };
const vault = { state: { id: vaultId, owner, status: 0, requestId: 0 } } as Vault;

describe('evidence enrollment and receipt state', () => {
  it('permits enrollment only on a vault with no recovery attempt', () => {
    expect(canEnrollEvidence(vault)).toBe(true);
    expect(canEnrollEvidence({ ...vault, state: { ...vault.state, status: 1, requestId: 1 } })).toBe(false);
    expect(canEnrollEvidence({ ...vault, state: { ...vault.state, status: 0, requestId: 1 } })).toBe(false);
  });

  it('builds a signed commitment payload without plaintext identity fields', async () => {
    const wallet = Wallet.createRandom();
    const payload = await prepareEvidenceEnrollment(config, vaultId, wallet.address, 'Demo Person', 'DEMO-042', wallet, '11'.repeat(32));
    expect(Object.keys(payload).sort()).toEqual(['commitment', 'owner', 'saltHex', 'signature']);
    expect(JSON.stringify(payload)).not.toContain('Demo Person');
    expect(JSON.stringify(payload)).not.toContain('DEMO-042');
    expect(verifyMessage(`Heirloom evidence identity enrollment v1\nchain:31337\ncontract:${config.contractAddress}\ndeployment:${config.deploymentId}\nvault:${vaultId}\nowner:${wallet.address.toLowerCase()}\ncommitment:${payload.commitment}\nsalt:${payload.saltHex}`, payload.signature)).toBe(wallet.address);
  });

  it('rejects files over 10 MiB or without PDF type before upload', () => {
    expect(() => validateEvidenceFile({ size: 10 * 1024 * 1024, type: 'application/pdf' })).not.toThrow();
    expect(() => validateEvidenceFile({ size: 10 * 1024 * 1024 + 1, type: 'application/pdf' })).toThrow(/10 MiB/i);
    expect(() => validateEvidenceFile({ size: 10, type: 'image/png' })).toThrow(/PDF/i);
  });

  it('has distinct labels and never treats a previous request as current', () => {
    expect((['government_issuer_verified', 'test_issuer_verified', 'signed_issuer_unverified', 'indeterminate', 'failed'] as EvidenceStatus[]).map(evidenceStatusLabel)).toEqual([
      'Government issuer verified', 'Test issuer verified', 'Signed, issuer unverified', 'Indeterminate', 'Failed'
    ]);
    const receipt = { requestId: 1, status: 'test_issuer_verified' } as EvidenceReceipt;
    expect(isCurrentEvidenceReceipt(receipt, { ...vault, state: { ...vault.state, status: 1, requestId: 1 } })).toBe(true);
    expect(isCurrentEvidenceReceipt(receipt, { ...vault, state: { ...vault.state, status: 1, requestId: 2 } })).toBe(false);
    expect(isCurrentEvidenceReceipt(receipt, { ...vault, state: { ...vault.state, status: 0, requestId: 1 } })).toBe(false);
  });
});
