import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, batchExtract, getPresetSchema, resolveSchema } from './client';

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
          cost_usd: 0.0001, cost_cny: 0.000725,
          error: null,
        },
      ],
      total_cost_usd: 0.0001, total_cost_cny: 0.000725, cost_cny: 0.000725,
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
        total_cost_usd: 0, total_cost_cny: 0, cost_cny: 0,
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

  it('posts a schema instead of a preset when schema is provided', async () => {
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

    const schema = { fields: { name: { type: 'string', description: null } } };
    await batchExtract({ texts: ['a'], schema });

    const call = fetchMock.mock.calls[0][1];
    expect(JSON.parse(call.body)).toEqual({ texts: ['a'], schema });
  });
});

describe('getPresetSchema', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches and parses a preset schema', async () => {
    const payload = {
      fields: [
        { name: 'name', type: 'string', description: 'Full name' },
        { name: 'email', type: 'string', description: null },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getPresetSchema('contact');

    expect(fetchMock).toHaveBeenCalledWith('/api/presets/contact/schema');
    expect(result.fields).toHaveLength(2);
  });

  it('throws ApiError on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => 'Unknown preset',
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getPresetSchema('bogus')).rejects.toMatchObject({
      status: 404,
      message: 'Unknown preset',
    });
  });
});

describe('resolveSchema', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts fields and parses a successful response', async () => {
    const payload = {
      schema: { fields: { company_name: { type: 'string', description: 'Full name', required: true } } },
      tokens_used: { input: 50, output: 20 },
      cost_usd: 0.0001,
      cost_cny: 0.000725,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    vi.stubGlobal('fetch', fetchMock);

    const fields = [{ display_name: 'Company Name', description: 'Full name', type: 'string' }];
    const result = await resolveSchema(fields);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/schema/resolve',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ fields }),
      }),
    );
    expect(result.schema.fields.company_name.type).toBe('string');
  });

  it('throws ApiError on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      text: async () => 'duplicate field name',
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      resolveSchema([{ display_name: 'X', description: '', type: 'string' }]),
    ).rejects.toMatchObject({ status: 422, message: 'duplicate field name' });
  });
});
