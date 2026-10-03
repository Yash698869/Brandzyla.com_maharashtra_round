import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { obtainIdentity, storedIdentity, custodyRecord, createBackedStoredIdentity, verifyStoredBackup, restoreStoredIdentity } from './identity';
import { publicKeyHash } from './crypto';
import { createBackedIdentity } from './identity-backup';

const address = '0x1111111111111111111111111111111111111111';
const passphrase = 'quiet river lantern orange 42';
const context = { chainId: 11155111, contractAddress: '0x2222222222222222222222222222222222222222', deploymentId: `0x${'a'.repeat(64)}`, address };

describe('browser identity custody', () => {
  it('concurrent tabs retain one identity rather than overwriting an enrolled key', async () => {
    const namespace = `test:${crypto.randomUUID()}`;
    const identities = await Promise.all([obtainIdentity(namespace, address), obtainIdentity(namespace, address)]);
    expect(publicKeyHash(identities[0].publicKey)).toBe(publicKeyHash(identities[1].publicKey));
    expect(publicKeyHash((await storedIdentity(namespace, address))!.publicKey)).toBe(publicKeyHash(identities[0].publicKey));
    expect(identities[0].privateKey.extractable).toBe(false);
  });

  it('preserves legacy identities without inventing a backup', async () => {
    const namespace = `legacy:${crypto.randomUUID()}`;
    const identity = await obtainIdentity(namespace, address);
    const record = await custodyRecord(namespace, address);
    expect(record?.backup).toBeUndefined();
    expect(record?.verified).toBe(false);
    expect(publicKeyHash(record!.identity.publicKey)).toBe(publicKeyHash(identity.publicKey));
  });

  it('stores a backed key as non-extractable and verifies only its matching file', async () => {
    const namespace = `backed:${crypto.randomUUID()}`;
    const backup = await createBackedStoredIdentity(namespace, address, passphrase, context);
    expect((await custodyRecord(namespace, address))?.verified).toBe(false);
    expect((await storedIdentity(namespace, address))?.privateKey.extractable).toBe(false);
    await expect(verifyStoredBackup(namespace, address, backup, 'bad', context)).rejects.toThrow();
    expect((await custodyRecord(namespace, address))?.verified).toBe(false);
    await verifyStoredBackup(namespace, address, backup, passphrase, context);
    expect((await custodyRecord(namespace, address))?.verified).toBe(true);
    expect((await custodyRecord(namespace, address))?.backup).toEqual(backup);
  });

  it('restores an enrolled key idempotently and rejects a different existing key', async () => {
    const namespace = `restore:${crypto.randomUUID()}`;
    const { backup, identity } = await createBackedIdentity(context, passphrase);
    const hash = publicKeyHash(identity.publicKey);
    const restored = await restoreStoredIdentity(namespace, address, backup, passphrase, context, hash);
    expect(restored.privateKey.extractable).toBe(false);
    expect(publicKeyHash(restored.publicKey)).toBe(hash);
    expect(publicKeyHash((await restoreStoredIdentity(namespace, address, backup, passphrase, context, hash)).publicKey)).toBe(hash);
    const different = await createBackedIdentity(context, passphrase);
    await expect(restoreStoredIdentity(namespace, address, different.backup, passphrase, context)).rejects.toThrow();
    expect(publicKeyHash((await storedIdentity(namespace, address))!.publicKey)).toBe(hash);
  });

  it('does not let concurrent tabs replace the first stored key', async () => {
    const namespace = `race:${crypto.randomUUID()}`;
    const results = await Promise.allSettled([
      createBackedStoredIdentity(namespace, address, passphrase, context),
      createBackedStoredIdentity(namespace, address, passphrase, context),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const winner = results.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof createBackedStoredIdentity>>>;
    expect(publicKeyHash((await storedIdentity(namespace, address))!.publicKey)).toBe(winner.value.publicKeyHash);
  });
});
