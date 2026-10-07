import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useBatchExtract } from './useBatchExtract';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useBatchExtract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls /api/batch_extract and returns adapted sources', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            data: { name: 'Acme', name_confidence: 0.9 },
            tokens_used: { input: 10, output: 5 },
            cost_usd: 0.0001, cost_cny: 0.000725,
            error: null,
          },
        ],
        total_cost_usd: 0.0001, total_cost_cny: 0.000725, cost_cny: 0.000725,
        total_tokens: { input: 10, output: 5 },
        succeeded: 1,
        failed: 0,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useBatchExtract(), { wrapper });

    result.current.mutate({ texts: ['hello world'], preset: 'contact' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].results[0].data).toEqual({ name: 'Acme' });
    expect(result.current.data?.[0].results[0].confidence).toEqual({ name: 0.9 });
  });

  it('forwards lang into the request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [],
        total_cost_usd: 0, total_cost_cny: 0, cost_cny: 0,
        total_tokens: { input: 0, output: 0 },
        succeeded: 0,
        failed: 0,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useBatchExtract(), { wrapper });

    result.current.mutate({ texts: ['你好'], preset: 'contact', lang: 'zh' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.lang).toBe('zh');
  });

  it('surfaces an error on a failed request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      text: async () => 'Unknown preset',
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useBatchExtract(), { wrapper });

    result.current.mutate({ texts: ['hello'], preset: 'bogus' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Unknown preset');
  });
});
