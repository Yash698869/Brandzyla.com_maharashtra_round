export interface Identity { publicKey: JsonWebKey; privateKey: CryptoKey }
export interface Binding { chainId: number; contract: string; vaultId: string; beneficiary: string; beneficiaryKeyHash: string }
export interface Envelope { iv: string; wrappedKey: string; ciphertext: string }
export interface ProtectedPackage { version: 1; binding: Binding; beneficiaryPublicKey: JsonWebKey; iv: string; ciphertext: string; guardianShares: { guardian: string; envelope: Envelope }[] }
export interface ShareRelease { version: 1; binding: Binding; guardian: string; requestId: number; envelope: Envelope }
export interface AssetData { name: string; mime: string; bytes: Uint8Array }
export interface Actor { address: string; name: string; role: 'owner' | 'beneficiary' | 'guardian'; initials: string; isDemo?: boolean }
export interface Config { chainId: number; contractAddress: string; rpcUrl: string; abi: any[]; deploymentBlock: number; deploymentId: string; codeHash: string; transactionHash?: string; mode: 'local' | 'public'; confirmations: number; explorerUrl?: string; actors: Actor[] }
export interface VaultState { id: string; owner: string; beneficiary: string; guardians: string[]; inactivity: number; challenge: number; lastCheckIn: number; quorumAt: number; finalizedAt: number; requestId: number; approvalCount: number; status: number; commitment: string; beneficiaryKeyHash: string; approved: string[] }
export interface Vault { package: ProtectedPackage; state: VaultState; label: string; category: string; createdAt: number }
export interface TimelineEvent { name: string; vaultId: string; requestId?: number; actor?: string; hash: string; blockNumber: number; timestamp: number; count?: number }
export interface IdentityRecord { address: string; publicKey: JsonWebKey; signature: string; name?: string; role?: string }
