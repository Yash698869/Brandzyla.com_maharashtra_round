import type { Config, ProtectedPackage, IdentityRecord, ShareRelease, EvidenceEnrollmentPayload, EvidenceReceiptResponse } from './types';
import type { RecoveryKit } from './registration';
import { validateEvidenceFile } from './evidence';

let cachedToken: string | null = null;

export function setApiAuthToken(token: string | null) {
  cachedToken = token;
}

export function getApiAuthToken(): string | null {
  return cachedToken || (typeof localStorage !== 'undefined' ? localStorage.getItem('heirloom_auth_token') : null);
}

export async function request<T>(path: string, body?: unknown, customToken?: string): Promise<T> {
  const token = customToken || getApiAuthToken();
  const headers: Record<string, string> = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`/api/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Encrypted relay is unreachable. Check the connection and retry.');
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    if (!response.ok) {
      throw new Error(`Encrypted relay is unavailable (HTTP ${response.status}). Check the connection and retry.`);
    }
    throw new Error('Encrypted relay returned an unreadable response. Retry after reconnecting.');
  }

  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `Request failed (HTTP ${response.status})`;
    throw new Error(message);
  }

  return data as T;
}

async function uploadEvidence(vaultId: string, file: File): Promise<EvidenceReceiptResponse> {
  validateEvidenceFile(file);
  const token = getApiAuthToken();
  let response: Response;
  try {
    response = await fetch(`/api/evidence/${vaultId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/pdf', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: file
    });
  } catch { throw new Error('Evidence relay is unreachable. Check the connection and retry.'); }
  const data = await response.json().catch(() => ({ error: `Evidence relay returned HTTP ${response.status}` }));
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Evidence upload failed (HTTP ${response.status})`);
  return data as EvidenceReceiptResponse;
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
  evidenceEnrollment: (vaultId: string) => request<{ enrolled: boolean; vaultId: string }>(`evidence/${vaultId}/enrollment`),
  enrollEvidence: (vaultId: string, record: EvidenceEnrollmentPayload) => request<{ enrolled: boolean; vaultId: string }>(`evidence/${vaultId}/enrollment`, record),
  evidenceReceipt: (vaultId: string) => request<EvidenceReceiptResponse>(`evidence/${vaultId}`),
  uploadEvidence,
  clock: (seconds: number) => request('clock', { seconds }),
  sendOtp: (email: string) =>
    request<{ ok: boolean; message: string; devCode?: string; devNotice?: string }>('auth/send-otp', { email }),
  verifyOtp: (email: string, code: string) =>
    request<{ ok: boolean; verified: boolean; message: string }>('auth/verify-otp', { email, code }),
  walletChallenge: (payload: { action: 'register' | 'login'; email: string; address: string }) =>
    request<{ ok: boolean; challenge: string; message: string }>('auth/wallet-challenge', payload),
  register: (payload: { name: string; email: string; password: string; role: string; address?: string; challenge?: string; signature?: string }) =>
    request<{ ok: boolean; token: string; user: any }>('auth/register', payload),
  login: (payload: { email: string; password: string; address?: string; challenge?: string; signature?: string }) =>
    request<{ ok: boolean; token: string; user: any }>('auth/login', payload),
  demoLogin: (payload: { address: string }) =>
    request<{ ok: boolean; token: string; user: any }>('auth/demo-login', payload),
  session: (token?: string) =>
    request<{ ok: boolean; user: any }>('auth/session', undefined, token),
  logout: (token?: string) =>
    request<{ ok: boolean }>('auth/logout', { token }, token),
};
