import { evidenceCommitment, evidenceEnrollmentMessage } from '../../shared/evidence-identity.mjs';
import type { Config, EvidenceEnrollmentPayload, EvidenceReceipt, EvidenceStatus, Vault } from './types';

const labels: Record<EvidenceStatus, string> = {
  government_issuer_verified: 'Government issuer verified',
  test_issuer_verified: 'Test issuer verified',
  signed_issuer_unverified: 'Signed, issuer unverified',
  indeterminate: 'Indeterminate',
  failed: 'Failed'
};

export function canEnrollEvidence(vault: Vault): boolean {
  return vault.state.status === 0 && vault.state.requestId === 0;
}

export function isCurrentEvidenceReceipt(receipt: EvidenceReceipt | null, vault: Vault): boolean {
  return Boolean(receipt && (vault.state.status === 1 || vault.state.status === 2) && receipt.requestId === vault.state.requestId);
}

export function evidenceStatusLabel(status: EvidenceStatus): string {
  return labels[status] ?? 'Indeterminate';
}

export function validateEvidenceFile(file: { size: number; type: string }): void {
  if (file.type !== 'application/pdf') throw new Error('Choose a PDF certificate');
  if (file.size < 1 || file.size > 10 * 1024 * 1024) throw new Error('PDF must be 10 MiB or smaller');
}

export async function prepareEvidenceEnrollment(
  config: Config,
  vaultId: string,
  owner: string,
  name: string,
  identifier: string,
  signer: { signMessage(message: string): Promise<string> },
  saltHex = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
): Promise<EvidenceEnrollmentPayload> {
  const commitment = await evidenceCommitment(name, identifier, saltHex);
  const signature = await signer.signMessage(evidenceEnrollmentMessage(config, vaultId, owner, commitment, saltHex));
  return { owner, commitment, saltHex, signature };
}
