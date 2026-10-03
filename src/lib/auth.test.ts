import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { getAuthToken, getSessionUser, loginWithEmail, registerUser, restoreSession, setAuthToken } from './auth';
import type { Config } from './types';

const user = {
  id: 'usr_1', email: 'person@example.com', name: 'Person', role: 'owner' as const,
  address: '0x1111111111111111111111111111111111111111', initials: 'PE'
};
const config = { mode: 'public', chainId: 11155111 } as Config;

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, user }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  })));
  setAuthToken('existing-session');
});

afterEach(() => { vi.unstubAllGlobals(); });

test('saved public session does not open without its connected wallet', async () => {
  vi.stubGlobal('window', { ethereum: { request: vi.fn(async ({ method }: { method: string }) =>
    method === 'eth_accounts' ? [] : '0xaa36a7') } });
  expect(await restoreSession(config)).toBeNull();
  expect(getSessionUser()).toBeNull();
  expect(getAuthToken()).toBeNull();
});

test('saved public session does not open with a different wallet', async () => {
  vi.stubGlobal('window', { ethereum: { request: vi.fn(async ({ method }: { method: string }) =>
    method === 'eth_accounts' ? ['0x2222222222222222222222222222222222222222'] : '0xaa36a7') } });
  expect(await restoreSession(config)).toBeNull();
  expect(getAuthToken()).toBeNull();
});

test('saved public session does not open on a different chain', async () => {
  vi.stubGlobal('window', { ethereum: { request: vi.fn(async ({ method }: { method: string }) =>
    method === 'eth_accounts' ? [user.address] : '0x1') } });
  expect(await restoreSession(config)).toBeNull();
  expect(getAuthToken()).toBeNull();
});

test('saved public session opens with the linked wallet on the configured chain', async () => {
  vi.stubGlobal('window', { ethereum: { request: vi.fn(async ({ method }: { method: string }) =>
    method === 'eth_accounts' ? [user.address] : '0xaa36a7') } });
  expect(await restoreSession(config)).toEqual(user);
  expect(getAuthToken()).toBe('existing-session');
});

test('public password login cannot create a session without a wallet', async () => {
  vi.stubGlobal('window', {});
  await expect(loginWithEmail('person@example.com', 'correct-password', config)).rejects.toThrow(/wallet/i);
  expect(getSessionUser()).toBeNull();
});

test('public signup cannot create an account without a wallet', async () => {
  vi.stubGlobal('window', {});
  await expect(registerUser({ name: 'Person', email: 'person@example.com', password: 'correct-password', role: 'owner' }, config))
    .rejects.toThrow(/wallet/i);
  expect(getSessionUser()).toBeNull();
});
