import { describe, expect, it } from 'vitest';
import { applyFieldEdit } from './review';
import type { ExtractionResult } from '@/types/extraction';

function makeResult(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    sourceId: 'text-0',
    index: '1',
    status: 'success',
    data: { vendor: 'Acme Corp', total: 1200 },
    confidence: { vendor: 0.9, total: 0.88 },
    avgConfidence: 0.89,
    tokensUsed: { input: 100, output: 20 },
    costUsd: 0.0002,
    costCny: 0.00145,
    ...overrides,
  };
}

describe('applyFieldEdit (review flow keeps the original value)', () => {
  it('snapshots the pre-edit value into originalData on the first edit', () => {
    const next = applyFieldEdit(makeResult(), 'vendor', 'Beta Ltd');

    expect(next.data).toEqual({ vendor: 'Beta Ltd', total: 1200 });
    expect(next.originalData).toEqual({ vendor: 'Acme Corp' });
    expect(next.reviewedFields).toEqual({ vendor: true });
  });

  it('keeps the FIRST snapshot when the same field is edited again', () => {
    const once = applyFieldEdit(makeResult(), 'vendor', 'Beta Ltd');
    const twice = applyFieldEdit(once, 'vendor', 'Gamma Inc');

    expect(twice.data).toEqual({ vendor: 'Gamma Inc', total: 1200 });
    // The original extraction value survives re-edits.
    expect(twice.originalData).toEqual({ vendor: 'Acme Corp' });
  });

  it('accumulates snapshots for different fields', () => {
    const once = applyFieldEdit(makeResult(), 'vendor', 'Beta Ltd');
    const twice = applyFieldEdit(once, 'total', 999);

    expect(twice.originalData).toEqual({ vendor: 'Acme Corp', total: 1200 });
    expect(twice.reviewedFields).toEqual({ vendor: true, total: true });
  });

  it('snapshots a null original value as null (not dropped)', () => {
    const result = makeResult({ data: { vendor: null }, confidence: { vendor: 0.4 } });
    const next = applyFieldEdit(result, 'vendor', 'Acme Corp');

    expect(next.data).toEqual({ vendor: 'Acme Corp' });
    expect(next.originalData).toEqual({ vendor: null });
  });

  it('does not mutate the input result', () => {
    const result = makeResult();
    applyFieldEdit(result, 'vendor', 'Beta Ltd');

    expect(result.data).toEqual({ vendor: 'Acme Corp', total: 1200 });
    expect(result.originalData).toBeUndefined();
    expect(result.reviewedFields).toBeUndefined();
  });

  it('treats a null-data result as an empty record (missing field snapshots as null)', () => {
    const result = makeResult({ data: null, confidence: {} });
    const next = applyFieldEdit(result, 'vendor', 'Beta Ltd');

    expect(next.data).toEqual({ vendor: 'Beta Ltd' });
    expect(next.originalData).toEqual({ vendor: null });
    expect(next.reviewedFields).toEqual({ vendor: true });
  });
});
