import { signerFor } from './chain';
import { obtainIdentity } from './identity';
import { api, setApiAuthToken } from './api';
import { identityMessage } from '../../shared/protocol.mjs';
import type { Config, Actor } from './types';

export type UserRole = 'owner' | 'beneficiary' | 'guardian';

export interface UserAccount {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  address: string;
  initials: string;
  isDemo?: boolean;
}

const AUTH_TOKEN_KEY = 'heirloom_auth_token';
const SESSION_USER_KEY = 'heirloom_session_user';

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null) {
  try {
    if (token) {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
      setApiAuthToken(token);
    } else {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      setApiAuthToken(null);
    }
  } catch {}
}

export function getSessionUser(): UserAccount | null {
  try {
    const raw = localStorage.getItem(SESSION_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSessionUser(user: UserAccount | null) {
  try {
    if (user) {
      localStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(SESSION_USER_KEY);
    }
  } catch {}
}

// Backward-compatible aliases for workspace
export const getCurrentUser = (defaultActors: Actor[] = []): UserAccount | null => {
  const current = getSessionUser();
  if (current && defaultActors.length > 0) {
    const match = defaultActors.find(a => a.address.toLowerCase() === current.address.toLowerCase());
    if (match) {
      return {
        ...current,
        name: match.name,
        role: match.role as UserRole,
        initials: match.initials,
      };
    }
  }
  return current;
};

export const setCurrentUser = (user: UserAccount | null) => {
  setSessionUser(user);
};

// Intentionally return undefined - private keys must never be stored in ordinary shared localStorage
export function getStoredPrivateKey(_address?: string): string | undefined {
  return undefined;
}

export function getDefaultDemoUsers(actors: Actor[] = []): UserAccount[] {
  const defaultList: { email: string; name: string; role: UserRole; initials: string }[] = [
    { email: 'alex@heirloom.local', name: 'Alex Morgan', role: 'owner', initials: 'AM' },
    { email: 'sam@heirloom.local', name: 'Sam Morgan', role: 'beneficiary', initials: 'SM' },
    { email: 'maya@heirloom.local', name: 'Maya Chen', role: 'guardian', initials: 'MC' },
    { email: 'james@heirloom.local', name: 'James Wilson', role: 'guardian', initials: 'JW' },
    { email: 'priya@heirloom.local', name: 'Priya Shah', role: 'guardian', initials: 'PS' },
  ];
  if (actors.length > 5) defaultList.push({ email: 'taylor@heirloom.local', name: 'Taylor Morgan', role: 'beneficiary', initials: 'TM' });

  return defaultList.map((d, index) => {
    const actor = actors.find(a => a.name.toLowerCase() === d.name.toLowerCase()) || actors[index];
    return {
      id: `demo-${actor ? actor.address.toLowerCase() : index + 1}`,
      email: d.email,
      name: actor ? actor.name : d.name,
      role: actor ? (actor.role as UserRole) : d.role,
      initials: actor ? actor.initials : d.initials,
      address: actor ? actor.address : '0x0000000000000000000000000000000000000000',
      isDemo: true,
    };
  });
}

export function getStoredUsers(defaultActors: Actor[] = []): UserAccount[] {
  return getDefaultDemoUsers(defaultActors);
}

export function formatActorName(name?: string): string {
  if (!name) return '';
  return name
    .trim()
    .split(/\s+/)
    .map(word => (word ? word.charAt(0).toUpperCase() + word.slice(1) : ''))
    .join(' ');
}

/**
 * Validates and restores the authenticated session with the server.
 */
export async function restoreSession(): Promise<UserAccount | null> {
  const token = getAuthToken();
  if (!token) {
    setSessionUser(null);
    return null;
  }

  try {
    const res = await api.session(token);
    if (res.ok && res.user) {
      setSessionUser(res.user);
      return res.user;
    }
  } catch (err) {
    console.warn('Session restoration failed:', err);
  }

  // Token is expired or invalid
  setAuthToken(null);
  setSessionUser(null);
  return null;
}

/**
 * Real authentication via server login endpoint.
 */
export async function loginWithEmail(email: string, password: string): Promise<UserAccount> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) throw new Error('Please enter your email address');
  if (!password) throw new Error('Please enter your password');

  const res = await api.login({ email: cleanEmail, password });
  if (!res.ok || !res.token || !res.user) {
    throw new Error('Authentication failed');
  }

  setAuthToken(res.token);
  setSessionUser(res.user);
  return res.user;
}

/**
 * Fast 1-click evaluation login for local Hardhat actors.
 */
export async function loginDemoActor(address: string): Promise<UserAccount> {
  if (!address) throw new Error('Demo actor address is required');

  const res = await api.demoLogin({ address });
  if (!res.ok || !res.token || !res.user) {
    throw new Error('Demo authentication failed');
  }

  setAuthToken(res.token);
  setSessionUser(res.user);
  return res.user;
}

/**
 * Account registration after email OTP verification.
 */
export async function registerUser(
  input: { name: string; email: string; password: string; role: UserRole; address?: string },
  config: Config
): Promise<UserAccount> {
  const trimmedName = input.name.trim();
  const cleanEmail = input.email.trim().toLowerCase();

  if (!trimmedName) throw new Error('Please enter your full name');
  if (!cleanEmail || !cleanEmail.includes('@')) throw new Error('Please enter a valid email address');
  if (input.password.length < 6) throw new Error('Password must be at least 6 characters long');

  // Submit registration to server
  const res = await api.register({
    name: trimmedName,
    email: cleanEmail,
    password: input.password,
    role: input.role,
    address: input.address,
  });

  if (!res.ok || !res.token || !res.user) {
    throw new Error('Registration failed on server');
  }

  const user: UserAccount = res.user;
  setAuthToken(res.token);
  setSessionUser(user);

  // Set up cryptographic identity in browser IndexedDB (RSA-OAEP)
  const namespace = `${config.chainId}:${config.contractAddress}:${config.deploymentId}`;
  try {
    const identity = await obtainIdentity(namespace, user.address);
    // If local chain and account is unlocked on node, enroll public key on relay
    if (config.mode === 'local') {
      try {
        const signer = await signerFor(config, user.address);
        const signature = await signer.signMessage(identityMessage(config, user.address, identity.publicKey));
        await api.enroll({
          address: user.address,
          publicKey: identity.publicKey,
          signature,
          name: user.name,
          role: user.role,
        });
      } catch (e) {
        console.warn('Could not auto-enroll identity signature on local relay:', e);
      }
    }
  } catch (err) {
    console.warn('Cryptographic identity provisioning notice:', err);
  }

  return user;
}

/**
 * Terminate session on server and client.
 */
export async function logoutUser(): Promise<void> {
  const token = getAuthToken();
  try {
    if (token) {
      await api.logout(token);
    }
  } catch (err) {
    console.warn('Logout API error:', err);
  } finally {
    setAuthToken(null);
    setSessionUser(null);
  }
}
