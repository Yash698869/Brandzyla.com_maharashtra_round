import { describe, expect, it, vi } from 'vitest';
import { friendlyError, watchWalletChanges } from './chain';

describe('wallet connection state', () => {
  it('invalidates the displayed actor when the wallet account or chain changes', () => {
    const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
    const provider = {
      on(event: string, handler: (...args: unknown[]) => void) {
        const set = handlers.get(event) ?? new Set(); set.add(handler); handlers.set(event, set);
      },
      removeListener(event: string, handler: (...args: unknown[]) => void) { handlers.get(event)?.delete(handler); },
    };
    const changed = vi.fn();
    const stop = watchWalletChanges(provider, changed);
    handlers.get('accountsChanged')?.forEach(handler => handler(['0x2222']));
    handlers.get('chainChanged')?.forEach(handler => handler('0xaa36a7'));
    expect(changed).toHaveBeenCalledTimes(2);
    stop();
    handlers.get('accountsChanged')?.forEach(handler => handler([]));
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('explains a rejected wallet action as a retryable cancellation', () => {
    expect(friendlyError({ code: 'ACTION_REJECTED', message: 'user rejected' })).toMatch(/wallet action was cancelled.*try again/i);
  });
});
