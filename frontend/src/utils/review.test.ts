import { describe, expect, it } from 'vitest';
import {
  applyFieldEdit,
  buildAllowEmptyFields,
  buildReviewThresholds,
  problemFields,
  reviewState,
} from './review';
import type { ExtractionResult, ExtractionSource, SchemaField } from '@/types/extraction';

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

const field = (overrides: Partial<SchemaField>): SchemaField => ({
  displayName: 'x',
  fieldName: null,
  type: 'string',
  description: '',
  ...overrides,
});

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

describe('buildAllowEmptyFields (issue #2 allow-empty = 0.0 tier)', () => {
  it('snapshots the fields whose tier is Allow empty (minConfidence 0)', () => {
    expect(
      buildAllowEmptyFields([
        field({ fieldName: 'notes', displayName: 'Notes', minConfidence: 0 }),
        field({ fieldName: 'vendor', displayName: 'Vendor', minConfidence: 0.9 }),
        field({ fieldName: 'total', displayName: 'Total' }),
      ]),
    ).toEqual(['notes']);
  });

  it('returns an empty list when no field sits at the 0.0 tier', () => {
    expect(buildAllowEmptyFields([field({ fieldName: 'vendor', minConfidence: 0.9 })])).toEqual([]);
    expect(buildAllowEmptyFields([field({ fieldName: 'vendor' })])).toEqual([]);
  });

  it('re-keys allowed fields through the resolved schema (display_name match)', () => {
    expect(
      buildAllowEmptyFields(
        [
          field({ fieldName: 'vendor', displayName: 'Vendor', minConfidence: 0 }),
          field({ fieldName: null, displayName: 'Remarks', minConfidence: 0 }),
        ],
        {
          vendor: { display_name: 'Vendor' },
          remark_1: { display_name: 'Remarks' },
        },
      ),
    ).toEqual(['vendor', 'remark_1']);
  });

  it('prefers the explicit field_name match over a display-name match', () => {
    expect(
      buildAllowEmptyFields(
        [
          field({ fieldName: 'total', displayName: 'Amount', minConfidence: 0 }),
          field({ fieldName: null, displayName: 'Grand Total', minConfidence: 0 }),
        ],
        { total: { display_name: 'Grand Total' } },
      ),
    ).toEqual(['total']);
  });
});

/** Minimal source input for the issue #3 helpers: only the two snapshots
 * reviewState/problemFields actually consume. */
function makeSource(
  overrides: Partial<Pick<ExtractionSource, 'reviewThresholds' | 'allowEmptyFields'>> = {},
): Pick<ExtractionSource, 'reviewThresholds' | 'allowEmptyFields'> {
  return { ...overrides };
}

describe('problemFields (issue #3 review triggers)', () => {
  it('returns the union of below-threshold and empty-violating fields', () => {
    const result = makeResult({
      data: { vendor: 'Acme', notes: null },
      confidence: { vendor: 0.6, notes: 0 },
    });

    expect(problemFields(result, makeSource())).toEqual({
      belowThreshold: [{ field: 'vendor', threshold: 0.85 }],
      empty: ['notes'],
    });
  });

  it('keeps empty fields out of belowThreshold (they carry no quality signal)', () => {
    const result = makeResult({ data: { notes: null }, confidence: { notes: 0 } });

    const problems = problemFields(result, makeSource());
    expect(problems.belowThreshold).toEqual([]);
    expect(problems.empty).toEqual(['notes']);
  });

  it('exempts fields the source allows to be empty', () => {
    const result = makeResult({ data: { notes: null }, confidence: { notes: 0 } });

    expect(problemFields(result, makeSource({ allowEmptyFields: ['notes'] }))).toEqual({
      belowThreshold: [],
      empty: [],
    });
  });

  it('judges each field against its own configured threshold', () => {
    const result = makeResult({ data: { vendor: 'Acme' }, confidence: { vendor: 0.72 } });

    expect(problemFields(result, makeSource({ reviewThresholds: { vendor: 0.5 } }))).toEqual({
      belowThreshold: [],
      empty: [],
    });
  });
});

describe('reviewState (issue #3 three-state review status)', () => {
  it('is none for a healthy success result', () => {
    expect(reviewState(makeResult(), makeSource())).toBe('none');
  });

  it('is pending for a failed result even when reviewedFields is populated', () => {
    const result = makeResult({
      status: 'failed',
      data: null,
      confidence: {},
      reviewedFields: { vendor: true },
    });
    expect(reviewState(result, makeSource())).toBe('pending');
  });

  it('is pending while a below-threshold field is unreviewed', () => {
    const result = makeResult({ confidence: { vendor: 0.6, total: 0.88 } });
    expect(reviewState(result, makeSource())).toBe('pending');
  });

  it('becomes reviewed once every below-threshold field is reviewed', () => {
    const result = makeResult({
      confidence: { vendor: 0.6, total: 0.88 },
      reviewedFields: { vendor: true },
    });
    expect(reviewState(result, makeSource())).toBe('reviewed');
  });

  it('becomes reviewed once an empty-violating field is reviewed', () => {
    const result = makeResult({
      data: { vendor: null, total: 1200 },
      confidence: { vendor: 0, total: 0.88 },
      avgConfidence: 0.44,
      reviewedFields: { vendor: true },
    });
    expect(reviewState(result, makeSource())).toBe('reviewed');
  });

  it('stays pending when only some problem fields are reviewed', () => {
    const result = makeResult({
      data: { vendor: 'Acme', notes: null },
      confidence: { vendor: 0.6, notes: 0 },
      reviewedFields: { vendor: true },
    });
    expect(reviewState(result, makeSource())).toBe('pending');
  });

  it('stays pending for an aggregate-only flag (avg below LOW, no problem fields)', () => {
    // Only reachable when the user configures thresholds under CONFIDENCE_LOW:
    // every field clears its own bar, but the aggregate stays below 0.70.
    const result = makeResult({
      data: { vendor: 'Acme', total: 1200 },
      confidence: { vendor: 0.65, total: 0.65 },
      avgConfidence: 0.65,
    });
    const source = makeSource({ reviewThresholds: { vendor: 0.5, total: 0.5 } });
    expect(reviewState(result, source)).toBe('pending');

    // No fields are flagged, so reviewing everything still cannot clear it.
    const reviewed = { ...result, reviewedFields: { vendor: true, total: true } };
    expect(reviewState(reviewed, source)).toBe('pending');
  });

  it('ignores reviewedFields entries for fields that are not problem fields', () => {
    const result = makeResult({
      confidence: { vendor: 0.6, total: 0.88 },
      reviewedFields: { total: true, unrelated: true },
    });
    expect(reviewState(result, makeSource())).toBe('pending');
  });

  it('stays reviewed when a reviewed field is edited back to empty', () => {
    // applyFieldEdit marks the field reviewed even when the correction is
    // empty — the review mark covers the new empty-violating flag.
    const initial = makeResult({
      data: { vendor: 'Acme', total: 1200 },
      confidence: { vendor: 0.6, total: 0.88 },
    });
    const edited = applyFieldEdit(initial, 'vendor', null);
    expect(reviewState(edited, makeSource())).toBe('reviewed');
  });
});
