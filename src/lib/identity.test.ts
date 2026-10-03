import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { obtainIdentity, storedIdentity } from './identity';
import { publicKeyHash } from './crypto';

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
