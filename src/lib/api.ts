import type { Config, ProtectedPackage, IdentityRecord, ShareRelease } from './types';

export async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`); return data;
}
export const api = {
  config: () => request<Config & { blockTimestamp: number; blockNumber: number }>('config'),
  identities: () => request<IdentityRecord[]>('identities'),
  enroll: (identity: IdentityRecord) => request('identities', identity),
  packages: () => request<ProtectedPackage[]>('packages'),
  savePackage: (p: ProtectedPackage) => request('packages', { package: p }),
  releases: (id: string) => request<{ release: ShareRelease; signature: string }[]>(`releases/${id}`),
  release: (release: ShareRelease, signature: string) => request('releases', { release, signature }),
  clock: (seconds: number) => request('clock', { seconds }),
};
