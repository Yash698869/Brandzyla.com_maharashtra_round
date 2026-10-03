import { beforeAll, describe, expect, it } from 'vitest';
import { publicKeyHash } from './crypto';
import { createBackedIdentity, restoreBackedIdentity, type IdentityBackup } from './identity-backup';

const context = {
  chainId: 11155111,
  contractAddress: '0x1111111111111111111111111111111111111111',
  deploymentId: `0x${'a'.repeat(64)}`,
  address: '0x2222222222222222222222222222222222222222',
};
const passphrase = 'purple garden window 47! archive';
let backup: IdentityBackup;
let originalHash: string;

beforeAll(async () => {
  const created = await createBackedIdentity(context, passphrase);
  backup = created.backup;
  originalHash = publicKeyHash(created.identity.publicKey);
});

describe('encrypted identity backup', () => {
  it('restores the same usable identity without exposing its private key', async () => {
    const restored = await restoreBackedIdentity(backup, passphrase, context, originalHash);
    expect(restored.privateKey.extractable).toBe(false);
    expect(publicKeyHash(restored.publicKey)).toBe(originalHash);
    const publicKey = await crypto.subtle.importKey('jwk', restored.publicKey, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const clear = new TextEncoder().encode('guardian share');
    const wrapped = await crypto.subtle.encrypt('RSA-OAEP', publicKey, clear);
    expect(new Uint8Array(await crypto.subtle.decrypt('RSA-OAEP', restored.privateKey, wrapped))).toEqual(clear);
    expect(JSON.stringify(backup)).not.toContain(passphrase);
    expect(backup.ciphertext).not.toContain('privateKey');
  });

  it('rejects a wrong passphrase or modified ciphertext and header', async () => {
    await expect(restoreBackedIdentity(backup, 'wrong passphrase', context)).rejects.toThrow();
    await expect(restoreBackedIdentity({ ...backup, ciphertext: backup.ciphertext.replace(/^./, backup.ciphertext[0] === 'A' ? 'B' : 'A') }, passphrase, context)).rejects.toThrow();
    await expect(restoreBackedIdentity({ ...backup, context: { ...backup.context, address: '0x3333333333333333333333333333333333333333' } }, passphrase, { ...context, address: '0x3333333333333333333333333333333333333333' })).rejects.toThrow();
  });

  it('rejects another wallet, deployment, or enrolled public key', async () => {
    await expect(restoreBackedIdentity(backup, passphrase, { ...context, address: '0x3333333333333333333333333333333333333333' })).rejects.toThrow();
    await expect(restoreBackedIdentity(backup, passphrase, { ...context, deploymentId: `0x${'b'.repeat(64)}` })).rejects.toThrow();
    await expect(restoreBackedIdentity(backup, passphrase, context, `0x${'0'.repeat(64)}`)).rejects.toThrow();
    await expect(restoreBackedIdentity({ ...backup, publicKey: { ...backup.publicKey, n: 'broken' } }, passphrase, context)).rejects.toThrow();
  });

  it('rejects malformed files and unsafe KDF parameters before derivation', async () => {
    await expect(createBackedIdentity(context, '')).rejects.toThrow();
    for (const iterations of [0, 599999, 1000001, Number.MAX_SAFE_INTEGER]) {
      await expect(restoreBackedIdentity({ ...backup, iterations }, passphrase, context)).rejects.toThrow();
    }
    await expect(restoreBackedIdentity({ ...backup, salt: '!' }, passphrase, context)).rejects.toThrow();
    await expect(restoreBackedIdentity({ ...backup, ciphertext: 'A'.repeat(70000) }, passphrase, context)).rejects.toThrow();
  });
});
