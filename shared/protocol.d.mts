export function canonical(value: unknown): string;
export function digest(value: unknown): string;
export function keyHash(key: JsonWebKey): string;
export function identityMessage(config: { chainId: number; contractAddress: string; deploymentId: string }, address: string, publicKey: JsonWebKey): string;
export function releaseMessage(release: unknown): string;
