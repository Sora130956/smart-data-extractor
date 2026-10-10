import { describe, expect, it } from 'vitest';
import {
  batchExtractResponseSchema,
  parsePdfResponseSchema,
  presetListResponseSchema,
  presetSchemaResponseSchema,
  schemaResolveResponseSchema,
} from './schemas';

describe('batchExtractResponseSchema', () => {
  it('parses a response with a mix of succeeded and failed items', () => {
    const payload = {
      results: [
        {
          data: { invoice_number: 'INV-001', invoice_number_confidence: 0.92 },
          tokens_used: { input: 120, output: 40 },
          cost_usd: 0.0002, cost_cny: 0.00145,
          error: null,
        },
        {
          data: null,
          tokens_used: { input: 0, output: 0 },
          cost_usd: 0, cost_cny: 0,
          error: 'unable to parse scanned page',
        },
      ],
      total_cost_usd: 0.0002, total_cost_cny: 0.00145, cost_cny: 0.00145,
      total_tokens: { input: 120, output: 40 },
      succeeded: 1,
      failed: 1,
    };

    const parsed = batchExtractResponseSchema.parse(payload);
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0].data).toEqual({
      invoice_number: 'INV-001',
      invoice_number_confidence: 0.92,
    });
    expect(parsed.results[1].data).toBeNull();
    expect(parsed.results[1].error).toBe('unable to parse scanned page');
  });

  it('rejects a payload missing required fields', () => {
    const payload = {
      results: [],
      total_cost_usd: 0, total_cost_cny: 0, cost_cny: 0,
      total_tokens: { input: 0, output: 0 },
      succeeded: 0,
      // failed is missing
    };

    expect(() => batchExtractResponseSchema.parse(payload)).toThrow();
  });

  it('rejects a result item where data is present but error is missing', () => {
    const payload = {
      results: [
        {
          data: { a: 1 },
          tokens_used: { input: 1, output: 1 },
          cost_usd: 0, cost_cny: 0,
          // error is missing (must be explicit null on success)
        },
      ],
      total_cost_usd: 0, total_cost_cny: 0, cost_cny: 0,
      total_tokens: { input: 1, output: 1 },
      succeeded: 1,
      failed: 0,
    };

    expect(() => batchExtractResponseSchema.parse(payload)).toThrow();
  });
});

describe('presetSchemaResponseSchema', () => {
  it('parses a list of fields with bilingual descriptions', () => {
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
          description_en: 'Email address of the contact',
        },
      ],
    };

    const parsed = presetSchemaResponseSchema.parse(payload);
    expect(parsed.fields).toHaveLength(2);
    expect(parsed.fields[0].field_name).toBe('name');
    expect(parsed.fields[0].description_zh).toBe('联系人全名');
    expect(parsed.fields[1].description_zh).toBeNull();
    expect(parsed.fields[1].description_en).toBe('Email address of the contact');
  });

  it('rejects the legacy single-description shape', () => {
    const payload = {
      fields: [
        {
          field_name: 'name',
          display_name_zh: '姓名',
          display_name_en: 'Name',
          type: 'string',
          format: null,
          description: 'Full name',
        },
      ],
    };

    expect(() => presetSchemaResponseSchema.parse(payload)).toThrow();
  });

  it('rejects a field missing the type key', () => {
    const payload = {
      fields: [
        {
          field_name: 'name',
          display_name_zh: '姓名',
          display_name_en: 'Name',
          format: null,
          description_zh: '联系人全名',
          description_en: 'Full name',
        },
      ],
    };

    expect(() => presetSchemaResponseSchema.parse(payload)).toThrow();
  });
});

describe('presetListResponseSchema', () => {
  it('parses a list of presets with localized display names', () => {
    const payload = [
      { id: 'contact', display_name_zh: '联系人', display_name_en: 'Contact', is_builtin: true },
      { id: 'custom1', display_name_zh: '自定义', display_name_en: 'Custom', is_builtin: false },
    ];

    const parsed = presetListResponseSchema.parse(payload);
    expect(parsed).toHaveLength(2);
    expect(parsed[1].is_builtin).toBe(false);
  });

  it('rejects an item missing a display name', () => {
    const payload = [{ id: 'contact', display_name_en: 'Contact', is_builtin: true }];

    expect(() => presetListResponseSchema.parse(payload)).toThrow();
  });
});

describe('schemaResolveResponseSchema', () => {
  it('parses a resolved schema with a map of generated field names', () => {
    const payload = {
      schema: {
        fields: {
          company_name: { type: 'string', description: 'Full name', required: true },
        },
      },
      tokens_used: { input: 50, output: 20 },
      cost_usd: 0.0001,
      cost_cny: 0.000725,
    };

    const parsed = schemaResolveResponseSchema.parse(payload);
    expect(parsed.schema.fields.company_name.required).toBe(true);
  });

  it('keeps the per-field display name echoed by the backend', () => {
    const payload = {
      schema: {
        fields: {
          urgency_level: { type: 'string', description: null, required: false, display_name: 'Urgency Level' },
          company_name: { type: 'string', description: null, required: true, display_name: null },
        },
      },
      tokens_used: { input: 50, output: 20 },
      cost_usd: 0.0001,
      cost_cny: 0.000725,
    };

    const parsed = schemaResolveResponseSchema.parse(payload);
    expect(parsed.schema.fields.urgency_level.display_name).toBe('Urgency Level');
    expect(parsed.schema.fields.company_name.display_name).toBeNull();
  });

  it('rejects a payload missing the schema key', () => {
    const payload = { tokens_used: { input: 0, output: 0 }, cost_usd: 0, cost_cny: 0 };

    expect(() => schemaResolveResponseSchema.parse(payload)).toThrow();
  });
});

describe('parsePdfResponseSchema', () => {
  it('parses a successful OCR response', () => {
    const payload = {
      text: 'extracted OCR text',
      pages: ['extracted OCR text'],
      pages_failed: [],
      tokens_used: { input: 100, output: 20 },
      cost_usd: 0,
      cost_cny: 0,
    };

    const parsed = parsePdfResponseSchema.parse(payload);
    expect(parsed.text).toBe('extracted OCR text');
    expect(parsed.pages).toEqual(['extracted OCR text']);
    expect(parsed.pages_failed).toEqual([]);
  });

  it('parses a response with failed pages as null entries', () => {
    const payload = {
      text: 'page one',
      pages: ['page one', null, 'page three'],
      pages_failed: [1],
      tokens_used: { input: 50, output: 10 },
      cost_usd: 0.001,
      cost_cny: 0.00725,
    };

    const parsed = parsePdfResponseSchema.parse(payload);
    expect(parsed.pages).toEqual(['page one', null, 'page three']);
    expect(parsed.pages_failed).toEqual([1]);
  });

  it('rejects a payload missing text', () => {
    const payload = {
      pages: ['text'],
      pages_failed: [],
      tokens_used: { input: 0, output: 0 },
      cost_usd: 0,
      cost_cny: 0,
    };

    expect(() => parsePdfResponseSchema.parse(payload)).toThrow();
  });

  it('rejects a payload missing pages', () => {
    const payload = {
      text: 'extracted OCR text',
      pages_failed: [],
      tokens_used: { input: 0, output: 0 },
      cost_usd: 0,
      cost_cny: 0,
    };

    expect(() => parsePdfResponseSchema.parse(payload)).toThrow();
  });

  it('parses per-page base64 renders when present (D-027)', () => {
    const payload = {
      text: 'page one',
      pages: ['page one'],
      pages_failed: [],
      pages_images: ['aGk=', 'Ynk='],
      tokens_used: { input: 0, output: 0 },
      cost_usd: 0,
      cost_cny: 0,
    };

    const parsed = parsePdfResponseSchema.parse(payload);
    expect(parsed.pages_images).toEqual(['aGk=', 'Ynk=']);
  });

  it('tolerates a missing pages_images key (older backends)', () => {
    const payload = {
      text: 'page one',
      pages: ['page one'],
      pages_failed: [],
      tokens_used: { input: 0, output: 0 },
      cost_usd: 0,
      cost_cny: 0,
    };

    const parsed = parsePdfResponseSchema.parse(payload);
    expect(parsed.pages_images).toBeUndefined();
  });

  it('tolerates an explicit null pages_images (image parse keeps it unset)', () => {
    const payload = {
      text: 'image OCR text',
      pages: ['image OCR text'],
      pages_failed: [],
      pages_images: null,
      tokens_used: { input: 0, output: 0 },
      cost_usd: 0,
      cost_cny: 0,
    };

    const parsed = parsePdfResponseSchema.parse(payload);
    expect(parsed.pages_images).toBeNull();
  });

  it('parses per-page grounding blocks when present (D-028)', () => {
    const payload = {
      text: 'page one',
      pages: ['page one'],
      pages_failed: [],
      pages_images: ['aGk='],
      pages_blocks: [
        [
          { text: 'Invoice Number', box: [10, 20, 30, 25] },
          { text: 'INV-001', box: [40, 20, 60, 25] },
        ],
        null,
      ],
      tokens_used: { input: 0, output: 0 },
      cost_usd: 0,
      cost_cny: 0,
    };

    const parsed = parsePdfResponseSchema.parse(payload);
    expect(parsed.pages_blocks).toHaveLength(2);
    expect(parsed.pages_blocks?.[0]).toHaveLength(2);
    expect(parsed.pages_blocks?.[0]?.[1]).toEqual({ text: 'INV-001', box: [40, 20, 60, 25] });
    expect(parsed.pages_blocks?.[1]).toBeNull();
  });

  it('rejects a grounding block whose box is not a 4-number tuple', () => {
    const payload = {
      text: 'page one',
      pages: ['page one'],
      pages_failed: [],
      pages_blocks: [[{ text: 'INV-001', box: [1, 2, 3] }]],
      tokens_used: { input: 0, output: 0 },
      cost_usd: 0,
      cost_cny: 0,
    };

    expect(() => parsePdfResponseSchema.parse(payload)).toThrow();
  });

  it('tolerates a missing pages_blocks key (older backends)', () => {
    const payload = {
      text: 'page one',
      pages: ['page one'],
      pages_failed: [],
      tokens_used: { input: 0, output: 0 },
      cost_usd: 0,
      cost_cny: 0,
    };

    const parsed = parsePdfResponseSchema.parse(payload);
    expect(parsed.pages_blocks).toBeUndefined();
  });
});
