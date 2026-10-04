export interface Identity { publicKey: JsonWebKey; privateKey: CryptoKey }
export interface Binding { chainId: number; contract: string; vaultId: string; beneficiary: string; beneficiaryKeyHash: string; backupBeneficiary?: string; backupBeneficiaryKeyHash?: string; backupWaitingDuration?: number; inactivity?: number; challenge?: number }
export interface Envelope { iv: string; wrappedKey: string; ciphertext: string }
export interface ProtectedPackage { version: 1 | 2; binding: Binding; beneficiaryPublicKey: JsonWebKey; backupBeneficiaryPublicKey?: JsonWebKey; iv: string; ciphertext: string; guardianShares: { guardian: string; envelope: Envelope }[] }
export interface ShareRelease { version: 1 | 2; binding: Binding; guardian: string; requestId: number; recipient?: string; envelope: Envelope }
export interface AssetData { name: string; mime: string; bytes: Uint8Array }
export interface Actor { address: string; name: string; role: 'owner' | 'beneficiary' | 'guardian'; initials: string; isDemo?: boolean }
export interface Config { chainId: number; contractAddress: string; rpcUrl: string; abi: any[]; deploymentBlock: number; deploymentId: string; codeHash: string; transactionHash?: string; mode: 'local' | 'public'; confirmations: number; explorerUrl?: string; actors: Actor[] }
export interface VaultState { id: string; owner: string; beneficiary: string; guardians: string[]; inactivity: number; challenge: number; lastCheckIn: number; quorumAt: number; finalizedAt: number; requestId: number; approvalCount: number; status: number; commitment: string; beneficiaryKeyHash: string; approved: string[]; policyVersion?: number; backupBeneficiary?: string; backupWaitingDuration?: number; backupBeneficiaryKeyHash?: string; selectedBeneficiary?: string }
export interface Vault { package: ProtectedPackage; state: VaultState; label: string; category: string; createdAt: number }
export interface TimelineEvent { name: string; vaultId: string; requestId?: number; actor?: string; hash: string; blockNumber: number; timestamp: number; count?: number }
export interface IdentityRecord { address: string; publicKey: JsonWebKey; signature: string; name?: string; role?: string }
export type EvidenceCheck = 'pass' | 'fail' | 'indeterminate';
export type EvidenceStatus = 'government_issuer_verified' | 'test_issuer_verified' | 'signed_issuer_unverified' | 'indeterminate' | 'failed';
export interface EvidenceEnrollmentPayload { owner: string; commitment: string; saltHex: string; signature: string }
export interface EvidenceReceipt {
  vaultId: string; requestId: number; pdfSha256: string; status: EvidenceStatus;
  checks: { signature: EvidenceCheck; coverage: EvidenceCheck; chain: EvidenceCheck; revocation: EvidenceCheck; issuer: EvidenceCheck; fields: EvidenceCheck; identity: EvidenceCheck };
  signerFingerprint: string | null; issuerLabel: string; reasonCodes: string[]; verifiedAt: number;
}
export interface EvidenceReceiptResponse { receipt: EvidenceReceipt | null; historical: EvidenceReceipt | null }
