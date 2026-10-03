import { describe, expect, it } from 'vitest';
import { custodyStep, enrollmentMatches, needsCustodyKey } from './custody-flow';

describe('public wallet custody flow', () => {
  it('asks a new wallet to create a backed identity', () => {
    expect(custodyStep(false)).toBe('create');
  });
  it('offers restoration when a wallet is enrolled but this profile has no key', () => {
    expect(custodyStep(true)).toBe('restore');
  });
  it('requires file verification before enrollment', () => {
    expect(custodyStep(false, { backup: {} as never, verified: false })).toBe('verify');
    expect(custodyStep(false, { backup: {} as never, verified: true })).toBe('enroll');
  });
  it('marks a verified enrolled identity ready and an old one unbacked', () => {
    expect(custodyStep(true, { backup: {} as never, verified: true })).toBe('ready');
    expect(custodyStep(true, { verified: false })).toBe('legacy');
  });
  it('rejects a locally stored key that differs from the enrolled public key', () => {
    const first = { kty: 'RSA', n: 'first', e: 'AQAB' };
    const second = { kty: 'RSA', n: 'second', e: 'AQAB' };
    expect(enrollmentMatches(first, first)).toBe(true);
    expect(enrollmentMatches(first, second)).toBe(false);
  });
  it('keeps wallet-only safety actions available when an enrolled owner has lost this browser key', () => {
    expect(custodyStep(true)).toBe('restore');
    for (const action of ['checkIn', 'requestRecovery', 'approveRecovery', 'finalizeRecovery'] as const) {
      expect(needsCustodyKey(action)).toBe(false);
    }
    for (const action of ['create', 'release', 'decrypt'] as const) {
      expect(needsCustodyKey(action)).toBe(true);
    }
  });
});
