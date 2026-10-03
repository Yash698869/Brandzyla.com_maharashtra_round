import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { obtainIdentity, storedIdentity } from './identity';
import { publicKeyHash } from './crypto';
import * as identity from './identity';

describe('browser identity custody', () => {
  it('concurrent tabs retain one identity rather than overwriting an enrolled key', async () => {
    const namespace = `test:${crypto.randomUUID()}`;
    const address = '0x1111111111111111111111111111111111111111';
    const identities = await Promise.all([obtainIdentity(namespace, address), obtainIdentity(namespace, address)]);
    expect(publicKeyHash(identities[0].publicKey)).toBe(publicKeyHash(identities[1].publicKey));
    expect(publicKeyHash((await storedIdentity(namespace, address))!.publicKey)).toBe(publicKeyHash(identities[0].publicKey));
    expect(identities[0].privateKey.extractable).toBe(false);
  });
});

describe('wallet access when custody is on another browser', () => {
  it('keeps the wallet available for signed chain actions without creating a replacement key', () => {
    const enrolled = { address: '0x1111111111111111111111111111111111111111', publicKey: { kty: 'RSA', n: 'enrolled', e: 'AQAB' }, signature: '0xsigned' };
    expect((identity as any).walletCustodyStatus(enrolled, undefined)).toBe('wallet-only');
  });

  it('does not enroll a conflicting local encryption key', () => {
    const enrolled = { address: '0x1111111111111111111111111111111111111111', publicKey: { kty: 'RSA', n: 'enrolled', e: 'AQAB' }, signature: '0xsigned' };
    expect((identity as any).walletCustodyStatus(enrolled, { publicKey: { kty: 'RSA', n: 'different', e: 'AQAB' } })).toBe('mismatch');
  });
});
