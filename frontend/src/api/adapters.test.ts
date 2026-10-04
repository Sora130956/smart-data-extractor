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
    expect(sources[0].id).toBe('text-0');
    expect(sources[0].name).toBe('Manual Input 1');
    expect(sources[1].id).toBe('text-1');
    expect(sources[1].name).toBe('Manual Input 2');
    expect(sources[1].results[0].status).toBe('failed');
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
});
