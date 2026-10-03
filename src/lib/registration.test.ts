import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { registerWithRecovery, reconcilePendingRegistration } from './registration';
import { persistPending, pendingRegistrations, clearPending } from './identity';

describe('registration survives interrupted transactions', () => {
  it('preserves encrypted package before broadcasting and keeps it on receipt failure', async () => {
    const order: string[] = []; let pending: any;
    const entry = { package: { ciphertext: 'encrypted bytes' }, label: 'Family letter' };
    await expect(registerWithRecovery(entry as any, async e => { pending = e; order.push('persist'); }, async () => {
      expect(pending.package.ciphertext).toBe('encrypted bytes'); order.push('broadcast');
      return { hash: '0xpending', wait: async (_count: number, timeout: number) => { expect(timeout).toBe(90000); throw new Error('receipt disconnected'); } };
    }, async () => { order.push('publish'); }, async () => { pending = undefined; })).rejects.toThrow('receipt disconnected');
    expect(order).toEqual(['persist', 'broadcast', 'persist']); expect(pending.transactionHash).toBe('0xpending');
  });
  it('clears pending material only after relay persistence succeeds', async () => {
    let cleared = false;
    const entry = { package: { ciphertext: 'encrypted bytes' }, label: 'Family letter' };
    await expect(registerWithRecovery(entry as any, async () => {}, async () => ({ hash: '0xconfirmed', wait: async () => ({ status: 1 }) }), async () => { throw new Error('relay unavailable'); }, async () => { cleared = true; })).rejects.toThrow('relay unavailable');
    expect(cleared).toBe(false);
    await registerWithRecovery(entry as any, async () => {}, async () => ({ hash: '0xconfirmed', wait: async () => ({ status: 1 }) }), async () => {}, async () => { cleared = true; });
    expect(cleared).toBe(true);
  });

  it('recovers a broadcast registration from IndexedDB without broadcasting twice', async () => {
    const namespace = `registration:${crypto.randomUUID()}`;
    const vaultId = `0x${'ab'.repeat(32)}`;
    const entry = { package: { version: 1, binding: { vaultId }, ciphertext: 'encrypted bytes' }, label: 'Family letter', category: 'Family memories', createdAt: 1234 } as any;
    let broadcasts = 0, published = 0;
    await expect(registerWithRecovery(entry, record => persistPending(namespace, record), async () => {
      broadcasts++;
      return { hash: '0xsubmitted', wait: async () => { throw new Error('browser closed after broadcast'); } };
    }, async () => { published++; }, () => clearPending(namespace, vaultId))).rejects.toThrow('browser closed after broadcast');
    const [saved] = await pendingRegistrations(namespace);
    expect(saved.transactionHash).toBe('0xsubmitted');

    const result = await reconcilePendingRegistration(saved,
      async () => ({ id: vaultId, commitment: '0x837e01a6e7c030e980fb084015c2b3304f9786ae9d02ad0741e9f6951acb3752' }),
      async () => { published++; },
      async state => clearPending(namespace, state.id));
    expect(result).toBe('published');
    expect({ broadcasts, published }).toEqual({ broadcasts: 1, published: 1 });
    expect(await pendingRegistrations(namespace)).toEqual([]);
  });

  it('retains an unmined or mismatched registration without publishing its ciphertext', async () => {
    const namespace = `registration:${crypto.randomUUID()}`, vaultId = `0x${'ab'.repeat(32)}`;
    const entry = { package: { version: 1, binding: { vaultId }, ciphertext: 'encrypted bytes' }, label: 'Family letter', category: 'Family memories', createdAt: 1234 } as any;
    await persistPending(namespace, entry);
    let published = 0;
    const publish = async () => { published++; };
    const clear = async () => clearPending(namespace, vaultId);
    expect(await reconcilePendingRegistration(entry, async () => { throw { revert: { name: 'VaultNotFound' } }; }, publish, clear)).toBe('unmined');
    expect(await reconcilePendingRegistration(entry, async () => ({ id: vaultId, commitment: `0x${'00'.repeat(32)}` }), publish, clear)).toBe('mismatch');
    expect(published).toBe(0);
    expect((await pendingRegistrations(namespace)).length).toBe(1);
    await clear();
  });

  it('does not replace preserved ciphertext when another kit names the same unmined vault', async () => {
    const namespace = `registration:${crypto.randomUUID()}`, vaultId = `0x${'cd'.repeat(32)}`;
    const original = { package: { version: 1, binding: { vaultId }, ciphertext: 'original encrypted bytes' }, label: 'Original', category: 'Personal documents', createdAt: 1234 } as any;
    await persistPending(namespace, original);
    await persistPending(namespace, { ...original, transactionHash: '0xsubmitted' });
    await persistPending(namespace, original);
    await expect(persistPending(namespace, { ...original, package: { ...original.package, ciphertext: 'replacement bytes' } })).rejects.toThrow(/different encrypted package/i);
    const [saved] = await pendingRegistrations(namespace);
    expect(saved.package.ciphertext).toBe('original encrypted bytes');
    expect(saved.transactionHash).toBe('0xsubmitted');
    await clearPending(namespace, vaultId);
  });
});
