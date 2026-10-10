import { describe, expect, it } from 'vitest';
import { applyFieldEdit, buildReviewThresholds } from './review';
import type { ExtractionResult, SchemaField } from '@/types/extraction';

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

describe('buildReviewThresholds (issue #2 submit-time snapshot)', () => {
  const field = (overrides: Partial<SchemaField>): SchemaField => ({
    displayName: 'x',
    fieldName: null,
    type: 'string',
    description: '',
    ...overrides,
  });

  it('maps fields with a known fieldName and an explicit threshold', () => {
    const thresholds = buildReviewThresholds([
      field({ fieldName: 'vendor', displayName: 'Vendor', minConfidence: 0.9 }),
      field({ fieldName: 'total', displayName: 'Total' }),
    ]);

    expect(thresholds).toEqual({ vendor: 0.9 });
  });

  it('returns an empty map when no field carries a threshold', () => {
    expect(
      buildReviewThresholds([field({ fieldName: 'vendor', displayName: 'Vendor' })]),
    ).toEqual({});
  });

  it('re-keys thresholds through the resolved schema (display_name match)', () => {
    const thresholds = buildReviewThresholds(
      [
        // Known key survives resolve untouched.
        field({ fieldName: 'vendor', displayName: 'Vendor', minConfidence: 0.9 }),
        // Renamed field: backend assigns a fresh key, matched by display name.
        field({ fieldName: null, displayName: 'Grand Total', minConfidence: 0.8 }),
      ],
      {
        vendor: { display_name: 'Vendor' },
        amount_total: { display_name: 'Grand Total' },
      },
    );

    expect(thresholds).toEqual({ vendor: 0.9, amount_total: 0.8 });
  });

  it('prefers the explicit field_name match over a display-name match for the same key', () => {
    const thresholds = buildReviewThresholds(
      [
        field({ fieldName: 'total', displayName: 'Amount', minConfidence: 0.8 }),
        field({ fieldName: null, displayName: 'Grand Total', minConfidence: 0.6 }),
      ],
      { total: { display_name: 'Grand Total' } },
    );

    expect(thresholds).toEqual({ total: 0.8 });
  });
});
