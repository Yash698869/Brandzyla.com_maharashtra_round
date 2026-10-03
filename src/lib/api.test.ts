import { afterEach, describe, expect, it, vi } from 'vitest';
import { request } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('relay request failures', () => {
  it('explains an empty error response from a disconnected relay proxy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    await expect(request('packages', { package: {} })).rejects.toThrow(/encrypted relay.*unavailable.*500/i);
  });

  it('explains a network failure without exposing a fetch exception', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(request('packages')).rejects.toThrow(/encrypted relay.*unreachable/i);
  });

  it('preserves a relay validation error returned as JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"Wrong vault commitment"}', { status: 400, headers: { 'Content-Type': 'application/json' } })));
    await expect(request('packages', { package: {} })).rejects.toThrow('Wrong vault commitment');
  });
});
