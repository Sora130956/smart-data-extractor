import { describe, expect, it } from 'vitest';
import { batchExtractResponseSchema, presetSchemaResponseSchema } from './schemas';

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
  it('parses a list of fields with nullable descriptions', () => {
    const payload = {
      fields: [
        { name: 'name', type: 'string', description: 'Full name' },
        { name: 'email', type: 'string', description: null },
      ],
    };

    const parsed = presetSchemaResponseSchema.parse(payload);
    expect(parsed.fields).toHaveLength(2);
    expect(parsed.fields[1].description).toBeNull();
  });

  it('rejects a field missing the type key', () => {
    const payload = { fields: [{ name: 'name', description: 'Full name' }] };

    expect(() => presetSchemaResponseSchema.parse(payload)).toThrow();
  });
});
