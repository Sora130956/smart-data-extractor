import { describe, expect, it } from 'vitest';
import {
  batchExtractResponseSchema,
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

  it('rejects a payload missing the schema key', () => {
    const payload = { tokens_used: { input: 0, output: 0 }, cost_usd: 0, cost_cny: 0 };

    expect(() => schemaResolveResponseSchema.parse(payload)).toThrow();
  });
});
