import type { Config, ProtectedPackage, IdentityRecord, ShareRelease } from './types';
import type { RecoveryKit } from './registration';

export async function request<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Encrypted relay is unreachable. Check the connection and retry.');
  }
  let data: unknown;
  try { data = await response.json(); }
  catch {
    if (!response.ok) throw new Error(`Encrypted relay is unavailable (HTTP ${response.status}). Check the connection and retry.`);
    throw new Error('Encrypted relay returned an unreadable response. Retry after reconnecting.');
  }
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : `Request failed (HTTP ${response.status})`;
    throw new Error(message);
  }
  return data as T;
}
export const api = {
  config: () => request<Config & { blockTimestamp: number; blockNumber: number }>('config'),
  identities: () => request<IdentityRecord[]>('identities'),
  enroll: (identity: IdentityRecord) => request('identities', identity),
  packages: () => request<ProtectedPackage[]>('packages'),
  kit: (id: string) => request<RecoveryKit>(`kits/${id}`),
  savePackage: (p: ProtectedPackage) => request('packages', { package: p }),
  releases: (id: string) => request<{ release: ShareRelease; signature: string }[]>(`releases/${id}`),
  release: (release: ShareRelease, signature: string) => request('releases', { release, signature }),
  clock: (seconds: number) => request('clock', { seconds }),
};
