import type { ProtectedPackage } from './types';

export interface PendingRegistration { package: ProtectedPackage; label: string; category: string; createdAt: number; transactionHash?: string }
export async function registerWithRecovery(entry: PendingRegistration, persist: (entry: PendingRegistration) => Promise<void>, send: () => Promise<{ hash: string; wait: (confirmations: number, timeout: number) => Promise<unknown> }>, publish: () => Promise<void>, clear: () => Promise<void>): Promise<void> {
  await persist(entry);
  const tx = await send();
  await persist({ ...entry, transactionHash: tx.hash });
  await tx.wait(1, 90000);
  await publish();
  await clear();
}
