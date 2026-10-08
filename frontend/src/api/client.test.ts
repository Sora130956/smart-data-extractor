import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, batchExtract, getPresets, getPresetSchema, parseImage, parsePdf, resolveSchema } from './client';

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

  it('includes lang only when provided', async () => {
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

    await batchExtract({ texts: ['a'], preset: 'invoice', lang: 'zh' });
    await batchExtract({ texts: ['b'], preset: 'invoice' });

    const withLang = JSON.parse(fetchMock.mock.calls[0][1].body);
    const withoutLang = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(withLang).toEqual({ texts: ['a'], preset: 'invoice', lang: 'zh' });
    expect(withoutLang).toEqual({ texts: ['b'], preset: 'invoice' });
    expect('lang' in withoutLang).toBe(false);
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

describe('getPresets', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches and parses the preset list', async () => {
    const payload = [
      { id: 'contact', display_name_zh: '联系人', display_name_en: 'Contact', is_builtin: true },
      { id: 'invoice', display_name_zh: '发票', display_name_en: 'Invoice', is_builtin: true },
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getPresets();

    expect(fetchMock).toHaveBeenCalledWith('/api/presets');
    expect(result).toHaveLength(2);
    expect(result[0].display_name_en).toBe('Contact');
  });

  it('throws ApiError on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'boom',
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getPresets()).rejects.toMatchObject({ status: 500, message: 'boom' });
  });
});

describe('getPresetSchema', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches and parses a preset schema', async () => {
    const payload = {
      fields: [
        {
          field_name: 'name',
          display_name_zh: '姓名',
          display_name_en: 'Name',
          type: 'string',
          format: null,
          description_zh: '联系人全名',
          description_en: 'Full name of the contact person',
        },
        {
          field_name: 'email',
          display_name_zh: '邮箱',
          display_name_en: 'Email',
          type: 'string',
          format: null,
          description_zh: null,
          description_en: null,
        },
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
    expect(result.fields[0].field_name).toBe('name');
    expect(result.fields[0].description_zh).toBe('联系人全名');
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

describe('parsePdf', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the file as multipart form data and parses a successful response', async () => {
    const payload = {
      text: 'extracted OCR text',
      pages: ['extracted OCR text'],
      pages_failed: [],
      tokens_used: { input: 100, output: 20 },
      cost_usd: 0,
      cost_cny: 0,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    vi.stubGlobal('fetch', fetchMock);

    const file = new File([new Uint8Array([1, 2, 3])], 'doc.pdf', { type: 'application/pdf' });
    const result = await parsePdf(file);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/parse_pdf',
      expect.objectContaining({ method: 'POST' }),
    );
    const call = fetchMock.mock.calls[0][1];
    expect(call.body).toBeInstanceOf(FormData);
    expect(call.body.get('file')).toBe(file);
    expect(result.text).toBe('extracted OCR text');
  });

  it('throws ApiError on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      text: async () => 'File must be a PDF',
    });
    vi.stubGlobal('fetch', fetchMock);

    const file = new File([new Uint8Array([1])], 'doc.txt', { type: 'text/plain' });
    await expect(parsePdf(file)).rejects.toMatchObject({
      status: 422,
      message: 'File must be a PDF',
    });
  });
});

describe('parseImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the file as multipart form data and parses a successful response', async () => {
    const payload = {
      text: 'image OCR text',
      pages: ['image OCR text'],
      pages_failed: [],
      tokens_used: { input: 100, output: 20 },
      cost_usd: 0,
      cost_cny: 0,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    vi.stubGlobal('fetch', fetchMock);

    const file = new File([new Uint8Array([1, 2, 3])], 'scan.png', { type: 'image/png' });
    const result = await parseImage(file);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/parse_image',
      expect.objectContaining({ method: 'POST' }),
    );
    const call = fetchMock.mock.calls[0][1];
    expect(call.body).toBeInstanceOf(FormData);
    expect(call.body.get('file')).toBe(file);
    expect(result.text).toBe('image OCR text');
    expect(result.pages).toEqual(['image OCR text']);
  });

  it('throws ApiError on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      text: async () => 'File must be an image',
    });
    vi.stubGlobal('fetch', fetchMock);

    const file = new File([new Uint8Array([1])], 'scan.webp', { type: 'image/webp' });
    await expect(parseImage(file)).rejects.toMatchObject({
      status: 422,
      message: 'File must be an image',
    });
  });
});
