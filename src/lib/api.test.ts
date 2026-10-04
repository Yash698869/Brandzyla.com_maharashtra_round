import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, request, setApiAuthToken } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('certificate upload', () => {
  it('sends raw PDF bytes with the live session token', async () => {
    setApiAuthToken('guardian-session');
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{"receipt":null}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    await api.uploadEvidence('vault-id', new Blob(['%PDF-1.4'], { type: 'application/pdf' }) as File);
    expect(fetcher).toHaveBeenCalledOnce();
    const [, init] = fetcher.mock.calls[0];
    expect(init).toBeDefined();
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer guardian-session');
    expect(headers['Content-Type']).toBe('application/pdf');
    expect(init!.body).toBeInstanceOf(Blob);
    setApiAuthToken(null);
  });

  it('rejects an oversized PDF without making a network call', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(api.uploadEvidence('vault-id', { size: 10 * 1024 * 1024 + 1, type: 'application/pdf' } as File)).rejects.toThrow(/10 MiB/i);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

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
