import { describe, it, expect } from 'vitest';
import { registerWithRecovery } from './registration';

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
});
