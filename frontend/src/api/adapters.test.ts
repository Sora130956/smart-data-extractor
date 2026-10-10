import { describe, expect, it } from 'vitest';
import { adaptBatchExtractResponse } from './adapters';
import type { BatchExtractResponse } from './schemas';

describe('adaptBatchExtractResponse', () => {
  it('splits *_confidence fields out of data and computes the average', () => {
    const response: BatchExtractResponse = {
      results: [
        {
          data: {
            invoice_number: 'INV-001',
            invoice_number_confidence: 0.92,
            total: 42.5,
            total_confidence: 0.8,
          },
          tokens_used: { input: 100, output: 20 },
          cost_usd: 0.0002, cost_cny: 0.00145,
          error: null,
        },
      ],
      total_cost_usd: 0.0002, total_cost_cny: 0.00145,
      total_tokens: { input: 100, output: 20 },
      succeeded: 1,
      failed: 0,
    };

    const [source] = adaptBatchExtractResponse(response, ['some invoice text']);

    expect(source.type).toBe('text');
    expect(source.results).toHaveLength(1);
    const [result] = source.results;
    expect(result.status).toBe('success');
    expect(result.data).toEqual({ invoice_number: 'INV-001', total: 42.5 });
    expect(result.confidence).toEqual({ invoice_number: 0.92, total: 0.8 });
    expect(result.avgConfidence).toBeCloseTo(0.86);
    expect(source.stats.succeeded).toBe(1);
    expect(source.stats.failed).toBe(0);
    expect(source.stats.totalCostUsd).toBe(0.0002);
    expect(source.stats.avgConfidence).toBeCloseTo(0.86);
  });

  it('stamps the submitted template label onto every source for later export naming', () => {
    const response: BatchExtractResponse = {
      results: [
        {
          data: { a: '1' },
          tokens_used: { input: 1, output: 1 },
          cost_usd: 0, cost_cny: 0,
          error: null,
        },
        {
          data: { b: '2' },
          tokens_used: { input: 1, output: 1 },
          cost_usd: 0, cost_cny: 0,
          error: null,
        },
      ],
      total_cost_usd: 0, total_cost_cny: 0,
      total_tokens: { input: 2, output: 2 },
      succeeded: 2,
      failed: 0,
    };

    const sources = adaptBatchExtractResponse(response, ['t1', 't2'], undefined, undefined, '发票信息');

    expect(sources.map((s) => s.presetLabel)).toEqual(['发票信息', '发票信息']);
  });

  it('snapshots the review thresholds onto every source (issue #2)', () => {
    const response: BatchExtractResponse = {
      results: [
        {
          data: { a: '1' },
          tokens_used: { input: 1, output: 1 },
          cost_usd: 0, cost_cny: 0,
          error: null,
        },
      ],
      total_cost_usd: 0, total_cost_cny: 0,
      total_tokens: { input: 1, output: 1 },
      succeeded: 1,
      failed: 0,
    };

    const thresholds = { vendor: 0.9 };
    const [withThresholds] = adaptBatchExtractResponse(
      response, ['t1'], undefined, undefined, undefined, undefined, thresholds,
    );
    expect(withThresholds.reviewThresholds).toEqual({ vendor: 0.9 });

    // No configured threshold -> the key stays absent, not an empty object.
    const [without] = adaptBatchExtractResponse(response, ['t1']);
    expect(without).not.toHaveProperty('reviewThresholds');
    const [empty] = adaptBatchExtractResponse(
      response, ['t1'], undefined, undefined, undefined, undefined, {},
    );
    expect(empty).not.toHaveProperty('reviewThresholds');
  });

  it('snapshots the allow-empty field list onto every source (issue #2)', () => {
    const response: BatchExtractResponse = {
      results: [
        {
          data: { a: '1' },
          tokens_used: { input: 1, output: 1 },
          cost_usd: 0, cost_cny: 0,
          error: null,
        },
      ],
      total_cost_usd: 0, total_cost_cny: 0,
      total_tokens: { input: 1, output: 1 },
      succeeded: 1,
      failed: 0,
    };

    const [withAllowed] = adaptBatchExtractResponse(
      response, ['t1'], undefined, undefined, undefined, undefined, undefined, ['notes'],
    );
    expect(withAllowed.allowEmptyFields).toEqual(['notes']);

    // Nothing marked -> the key stays absent, not an empty array.
    const [without] = adaptBatchExtractResponse(response, ['t1']);
    expect(without).not.toHaveProperty('allowEmptyFields');
    const [empty] = adaptBatchExtractResponse(
      response, ['t1'], undefined, undefined, undefined, undefined, undefined, [],
    );
    expect(empty).not.toHaveProperty('allowEmptyFields');
  });

  it('maps a failed item to a failed result with null data and no confidence', () => {
    const response: BatchExtractResponse = {
      results: [
        {
          data: null,
          tokens_used: { input: 0, output: 0 },
          cost_usd: 0, cost_cny: 0,
          error: 'unable to parse scanned page',
        },
      ],
      total_cost_usd: 0, total_cost_cny: 0,
      total_tokens: { input: 0, output: 0 },
      succeeded: 0,
      failed: 1,
    };

    const [source] = adaptBatchExtractResponse(response, ['bad text']);
    const [result] = source.results;

    expect(result.status).toBe('failed');
    expect(result.data).toBeNull();
    expect(result.confidence).toEqual({});
    expect(result.avgConfidence).toBe(0);
    expect(result.error).toBe('unable to parse scanned page');
    expect(source.stats).toEqual({
      succeeded: 0,
      failed: 1,
      totalCostUsd: 0, totalCostCny: 0,
      avgConfidence: 0,
      schemaResolveCostUsd: 0, schemaResolveCostCny: 0,
    });
  });

  it('produces one Source per text, in request order', () => {
    const response: BatchExtractResponse = {
      results: [
        {
          data: { a: 1, a_confidence: 0.9 },
          tokens_used: { input: 1, output: 1 },
          cost_usd: 0.0001, cost_cny: 0.000725,
          error: null,
        },
        {
          data: null,
          tokens_used: { input: 0, output: 0 },
          cost_usd: 0, cost_cny: 0,
          error: 'boom',
        },
      ],
      total_cost_usd: 0.0001, total_cost_cny: 0.000725,
      total_tokens: { input: 1, output: 1 },
      succeeded: 1,
      failed: 1,
    };

    const sources = adaptBatchExtractResponse(response, ['first text', 'second text']);

    expect(sources).toHaveLength(2);
    expect(sources[0].id).toMatch(/^text-/);
    expect(sources[0].id).not.toBe(sources[1].id);
    expect(sources[0].name).toBe('Manual Input 1');
    expect(sources[1].name).toBe('Manual Input 2');
    expect(sources[1].results[0].status).toBe('failed');
  });

  it('generates ids unique across batches (accumulated results need distinct keys)', () => {
    const response: BatchExtractResponse = {
      results: [
        {
          data: { a: 1 },
          tokens_used: { input: 1, output: 1 },
          cost_usd: 0.0001, cost_cny: 0.000725,
          error: null,
        },
      ],
      total_cost_usd: 0.0001, total_cost_cny: 0.000725,
      total_tokens: { input: 1, output: 1 },
      succeeded: 1,
      failed: 0,
    };

    const batch1 = adaptBatchExtractResponse(response, ['first batch text']);
    const batch2 = adaptBatchExtractResponse(response, ['second batch text']);

    expect(batch1[0].id).not.toBe(batch2[0].id);
  });

  it('attributes the schema resolve cost to the first source only', () => {
    const response: BatchExtractResponse = {
      results: [
        {
          data: { a: 1, a_confidence: 0.9 },
          tokens_used: { input: 1, output: 1 },
          cost_usd: 0.0001, cost_cny: 0.000725,
          error: null,
        },
        {
          data: { b: 2, b_confidence: 0.8 },
          tokens_used: { input: 1, output: 1 },
          cost_usd: 0.0001, cost_cny: 0.000725,
          error: null,
        },
      ],
      total_cost_usd: 0.0002, total_cost_cny: 0.00145,
      total_tokens: { input: 2, output: 2 },
      succeeded: 2,
      failed: 0,
    };

    const sources = adaptBatchExtractResponse(response, ['first', 'second'], {
      costUsd: 0.0005,
      costCny: 0.0036,
    });

    expect(sources[0].stats.schemaResolveCostUsd).toBe(0.0005);
    expect(sources[0].stats.schemaResolveCostCny).toBe(0.0036);
    expect(sources[1].stats.schemaResolveCostUsd).toBe(0);
    expect(sources[1].stats.schemaResolveCostCny).toBe(0);
  });

  it('truncates the source meta preview and collapses whitespace', () => {
    const longText = `line one\n\n  line two   ${'x'.repeat(100)}`;
    const response: BatchExtractResponse = {
      results: [
        {
          data: { a: 1, a_confidence: 1 },
          tokens_used: { input: 1, output: 1 },
          cost_usd: 0, cost_cny: 0,
          error: null,
        },
      ],
      total_cost_usd: 0, total_cost_cny: 0,
      total_tokens: { input: 1, output: 1 },
      succeeded: 1,
      failed: 0,
    };

    const [source] = adaptBatchExtractResponse(response, [longText]);
    expect(source.meta).toHaveLength(60);
    expect(source.meta).not.toContain('\n');
  });

  it('attaches the submitted field-label map to every source', () => {
    const response: BatchExtractResponse = {
      results: [
        {
          data: { a: 1, a_confidence: 1 },
          tokens_used: { input: 1, output: 1 },
          cost_usd: 0.0001, cost_cny: 0.000725,
          error: null,
        },
        {
          data: { b: 2, b_confidence: 1 },
          tokens_used: { input: 1, output: 1 },
          cost_usd: 0.0001, cost_cny: 0.000725,
          error: null,
        },
      ],
      total_cost_usd: 0.0002, total_cost_cny: 0.00145,
      total_tokens: { input: 2, output: 2 },
      succeeded: 2,
      failed: 0,
    };
    const fieldLabels = { a: '数量', b: 'Number' };

    const sources = adaptBatchExtractResponse(response, ['first', 'second'], undefined, fieldLabels);

    expect(sources[0].fieldLabels).toEqual(fieldLabels);
    expect(sources[1].fieldLabels).toEqual(fieldLabels);
  });

  it('attaches the per-text file url to the matching source', () => {
    const response: BatchExtractResponse = {
      results: [
        {
          data: { a: 1, a_confidence: 1 },
          tokens_used: { input: 1, output: 1 },
          cost_usd: 0, cost_cny: 0,
          error: null,
        },
        {
          data: { b: 2, b_confidence: 1 },
          tokens_used: { input: 1, output: 1 },
          cost_usd: 0, cost_cny: 0,
          error: null,
        },
      ],
      total_cost_usd: 0, total_cost_cny: 0,
      total_tokens: { input: 2, output: 2 },
      succeeded: 2,
      failed: 0,
    };

    const sources = adaptBatchExtractResponse(
      response,
      ['first', 'second'],
      undefined,
      undefined,
      undefined,
      ['blob:one', undefined],
    );

    expect(sources[0].sourceFileUrl).toBe('blob:one');
    expect(sources[1].sourceFileUrl).toBeUndefined();
  });

  it('omits fieldLabels when none were submitted', () => {
    const response: BatchExtractResponse = {
      results: [
        {
          data: { a: 1, a_confidence: 1 },
          tokens_used: { input: 1, output: 1 },
          cost_usd: 0, cost_cny: 0,
          error: null,
        },
      ],
      total_cost_usd: 0, total_cost_cny: 0,
      total_tokens: { input: 1, output: 1 },
      succeeded: 1,
      failed: 0,
    };

    const [source] = adaptBatchExtractResponse(response, ['only']);

    expect(source.fieldLabels).toBeUndefined();
  });
});
