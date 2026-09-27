import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, batchExtract } from './client';

describe('batchExtract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts texts + preset and parses a successful response', async () => {
    const payload = {
      results: [
        {
          data: { name: 'Acme', name_confidence: 0.91 },
          tokens_used: { input: 10, output: 5 },
          cost_usd: 0.0001,
          error: null,
        },
      ],
      total_cost_usd: 0.0001,
      total_tokens: { input: 10, output: 5 },
      succeeded: 1,
      failed: 0,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await batchExtract({ texts: ['hello'], preset: 'contact' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batch_extract',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ texts: ['hello'], preset: 'contact' }),
      }),
    );
    expect(result.succeeded).toBe(1);
  });

  it('includes instructions only when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [],
        total_cost_usd: 0,
        total_tokens: { input: 0, output: 0 },
        succeeded: 0,
        failed: 0,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await batchExtract({ texts: ['a'], preset: 'invoice', instructions: 'focus on totals' });

    const call = fetchMock.mock.calls[0][1];
    expect(JSON.parse(call.body)).toEqual({
      texts: ['a'],
      preset: 'invoice',
      instructions: 'focus on totals',
    });
  });

  it('throws ApiError with status on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      text: async () => 'Unknown preset',
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(batchExtract({ texts: ['x'], preset: 'bogus' })).rejects.toMatchObject({
      status: 422,
      message: 'Unknown preset',
    });
  });

  it('ApiError is an instance of Error', () => {
    const err = new ApiError('boom', 500);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ApiError');
  });
});
