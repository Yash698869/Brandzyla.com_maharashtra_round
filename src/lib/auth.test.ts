import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { getAuthToken, getSessionUser, loginWithEmail, logoutUser, registerUser, restoreSession, setAuthToken } from './auth';
import { request } from './api';
import type { Config } from './types';

const user = {
  id: 'usr_1', email: 'person@example.com', name: 'Person', role: 'owner' as const,
  address: '0x1111111111111111111111111111111111111111', initials: 'PE'
};
const config = { mode: 'public', chainId: 11155111 } as Config;

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
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

test('different tabs retain their own login and relay authorization after another tab logs out', async () => {
  localStorage.removeItem('heirloom_auth_token');
  const tabA = memoryStorage();
  const tabB = memoryStorage();
  const beneficiary = { ...user, id: 'usr_2', email: 'beneficiary@example.com', role: 'beneficiary' as const };
  const authorizations: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/auth/login')) {
      const email = JSON.parse(init?.body as string).email;
      return Response.json({ ok: true, token: `${email}-token`, user: email === user.email ? user : beneficiary });
    }
    if (path.endsWith('/auth/logout')) return Response.json({ ok: true });
    authorizations.push((init?.headers as Record<string, string>)?.Authorization);
    return Response.json([]);
  }));

  vi.stubGlobal('sessionStorage', tabA);
  await loginWithEmail(user.email, 'password');
  await request('packages');

  vi.stubGlobal('sessionStorage', tabB);
  expect(getSessionUser()).toBeNull();
  expect(getAuthToken()).toBeNull();
  await loginWithEmail(beneficiary.email, 'password');
  await request('packages');

  vi.stubGlobal('sessionStorage', tabA);
  expect(getSessionUser()).toEqual(user);
  expect(getAuthToken()).toBe(`${user.email}-token`);
  await request('packages');
  await logoutUser();

  vi.stubGlobal('sessionStorage', tabB);
  expect(getSessionUser()).toEqual(beneficiary);
  expect(getAuthToken()).toBe(`${beneficiary.email}-token`);
  await request('packages');
  expect(authorizations).toEqual([
    `Bearer ${user.email}-token`,
    `Bearer ${beneficiary.email}-token`,
    `Bearer ${user.email}-token`,
    `Bearer ${beneficiary.email}-token`,
  ]);
});

test('an existing shared login moves into the first tab and is removed from shared storage', () => {
  sessionStorage.removeItem('heirloom_auth_token');
  localStorage.setItem('heirloom_auth_token', 'old-token');
  localStorage.setItem('heirloom_session_user', JSON.stringify(user));

  expect(getSessionUser()).toEqual(user);
  expect(getAuthToken()).toBe('old-token');
  expect(localStorage.getItem('heirloom_auth_token')).toBeNull();
  expect(localStorage.getItem('heirloom_session_user')).toBeNull();

  vi.stubGlobal('sessionStorage', memoryStorage());
  expect(getAuthToken()).toBeNull();
  expect(getSessionUser()).toBeNull();
});
