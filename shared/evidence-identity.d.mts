export function canonicalEvidenceIdentity(name: string, identifier: string): string;
export function evidenceCommitment(name: string, identifier: string, saltHex: string): Promise<string>;
export function evidenceEnrollmentMessage(
  config: { chainId: number; contractAddress: string; deploymentId: string },
  vaultId: string,
  owner: string,
  commitment: string,
  saltHex: string
): string;
