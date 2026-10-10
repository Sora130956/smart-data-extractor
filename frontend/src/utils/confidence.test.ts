import { describe, expect, it } from 'vitest';
import {
  CONFIDENCE_HIGH,
  CONFIDENCE_LOW,
  DEFAULT_MIN_CONFIDENCE,
  belowThresholdFields,
  confidenceLevel,
  emptyViolatingFields,
  fieldThreshold,
  formatConfidence,
  isEmptyValue,
  needsReview,
} from './confidence';

describe('confidenceLevel', () => {
  it('bands on the DESIGN.md §4 thresholds, inclusive at the boundary', () => {
    expect(confidenceLevel(1)).toBe('high');
    expect(confidenceLevel(CONFIDENCE_HIGH)).toBe('high');
    expect(confidenceLevel(CONFIDENCE_HIGH - 0.01)).toBe('medium');
    expect(confidenceLevel(CONFIDENCE_LOW)).toBe('medium');
    expect(confidenceLevel(CONFIDENCE_LOW - 0.01)).toBe('low');
    expect(confidenceLevel(0)).toBe('low');
  });
});

describe('needsReview', () => {
  it('flags a low aggregate', () => {
    expect(needsReview({ avgConfidence: 0.62, confidence: { a: 0.9 } })).toBe(true);
  });

  it('flags a healthy aggregate that hides one weak field', () => {
    expect(
      needsReview({ avgConfidence: 0.9, confidence: { a: 0.99, b: 0.41 } }),
    ).toBe(true);
  });

  it('passes when the aggregate and every field clear the default minimum', () => {
    expect(
      needsReview({ avgConfidence: 0.91, confidence: { a: 0.92, b: 0.9 } }),
    ).toBe(false);
  });

  it('flags a field below its own per-field threshold (issue #2)', () => {
    // vendor must reach 0.9; 0.85 is fine globally but not for vendor.
    expect(
      needsReview({
        avgConfidence: 0.9,
        confidence: { vendor: 0.85, total: 0.95 },
        thresholds: { vendor: 0.9 },
      }),
    ).toBe(true);
  });

  it('passes a field that would fail the global default but clears its own lower threshold', () => {
    expect(
      needsReview({
        avgConfidence: 0.9,
        confidence: { notes: 0.6, total: 0.95 },
        thresholds: { notes: 0.5 },
      }),
    ).toBe(false);
  });

  it('falls back to the default minimum for fields without a configured threshold', () => {
    expect(
      needsReview({
        avgConfidence: 0.9,
        confidence: { vendor: 0.95, total: 0.84 },
        thresholds: { vendor: 0.9 },
      }),
    ).toBe(true); // total has no entry -> judged against the 0.85 default
  });

  it('flags an empty field that is not allowed to be empty (issue #2)', () => {
    // The backend zeroes a null field's confidence, but the flag now comes
    // from the allow-empty rule, not from the threshold comparison.
    expect(
      needsReview({
        avgConfidence: 0.9,
        confidence: { vendor: 0, total: 0.95 },
        data: { vendor: null, total: 1200 },
      }),
    ).toBe(true);
  });

  it('passes an empty field marked allow-empty, and only for empty values', () => {
    expect(
      needsReview({
        avgConfidence: 0.9,
        confidence: { notes: 0, total: 0.95 },
        data: { notes: null, total: 1200 },
        allowEmpty: ['notes'],
      }),
    ).toBe(false);
    // The exemption never covers a non-empty value: that still has to
    // clear the confidence threshold like any other field.
    expect(
      needsReview({
        avgConfidence: 0.9,
        confidence: { notes: 0.5, total: 0.95 },
        data: { notes: 'late', total: 1200 },
        allowEmpty: ['notes'],
      }),
    ).toBe(true);
  });

  it('treats a 0.0 tier as no bar at all: empty or low non-empty values pass (issue #2)', () => {
    // Empty value on the 0.0 tier: exempted from the empty rule via the
    // snapshot, and its zeroed confidence is no quality signal anyway.
    expect(
      needsReview({
        avgConfidence: 0.9,
        confidence: { notes: 0, total: 0.95 },
        data: { notes: null, total: 1200 },
        thresholds: { notes: 0 },
        allowEmpty: ['notes'],
      }),
    ).toBe(false);
    // Non-empty but weak (0.5 >= 0.0): the 0.0 tier lifts the quality bar
    // entirely — a fully optional field never flags the batch.
    expect(
      needsReview({
        avgConfidence: 0.9,
        confidence: { notes: 0.5, total: 0.95 },
        data: { notes: 'late', total: 1200 },
        thresholds: { notes: 0 },
      }),
    ).toBe(false);
  });
});

describe('fieldThreshold', () => {
  it('returns the configured threshold for the field', () => {
    expect(fieldThreshold('vendor', { vendor: 0.9 })).toBe(0.9);
  });

  it('falls back to the default minimum when absent', () => {
    expect(fieldThreshold('vendor', { total: 0.9 })).toBe(DEFAULT_MIN_CONFIDENCE);
    expect(fieldThreshold('vendor', undefined)).toBe(DEFAULT_MIN_CONFIDENCE);
  });

  it('anchors the default on the High band boundary (legend: 高 ≥ 0.85)', () => {
    // User-set design: unconfigured fields are held to "high" by default, so
    // the tier options and the on-screen confidence legend tell one story.
    expect(DEFAULT_MIN_CONFIDENCE).toBe(CONFIDENCE_HIGH);
  });
});

describe('belowThresholdFields', () => {
  it('lists only the fields under their own threshold, each with that threshold', () => {
    expect(
      belowThresholdFields({
        confidence: { vendor: 0.85, total: 0.95, notes: 0.6 },
        thresholds: { vendor: 0.9, notes: 0.5 },
      }),
    ).toEqual([{ field: 'vendor', threshold: 0.9 }]);
  });

  it('judges unconfigured fields against the default minimum', () => {
    // 0.84 would have passed the old 0.70 default — it fails the 0.85 one.
    expect(
      belowThresholdFields({ confidence: { vendor: 0.84, total: 0.95 } }),
    ).toEqual([{ field: 'vendor', threshold: DEFAULT_MIN_CONFIDENCE }]);
  });

  it('returns an empty list when every field clears its threshold', () => {
    expect(
      belowThresholdFields({ confidence: { a: 0.99 }, thresholds: { a: 0.5 } }),
    ).toEqual([]);
  });

  it('excludes empty fields from the threshold list when data is available (issue #2)', () => {
    // An empty field is judged by the allow-empty rule instead — its
    // zeroed confidence is not a quality signal.
    expect(
      belowThresholdFields({
        confidence: { vendor: 0, total: 0.69 },
        data: { vendor: null, total: 1200 },
      }),
    ).toEqual([{ field: 'total', threshold: DEFAULT_MIN_CONFIDENCE }]);
  });

  it('keeps the legacy behaviour when no data is passed', () => {
    expect(belowThresholdFields({ confidence: { vendor: 0 } })).toEqual([
      { field: 'vendor', threshold: DEFAULT_MIN_CONFIDENCE },
    ]);
  });
});

describe('isEmptyValue', () => {
  it('treats null, missing, and empty strings as empty — never 0/false', () => {
    expect(isEmptyValue(null)).toBe(true);
    expect(isEmptyValue(undefined)).toBe(true);
    expect(isEmptyValue('')).toBe(true);
    expect(isEmptyValue(0)).toBe(false);
    expect(isEmptyValue(false)).toBe(false);
    expect(isEmptyValue('Acme')).toBe(false);
  });
});

describe('emptyViolatingFields (issue #2 allow-empty)', () => {
  it('lists empty fields that are not exempt, keeping the exemption list out', () => {
    expect(
      emptyViolatingFields({
        data: { vendor: null, notes: '', total: 0, paid: false, missing: undefined },
        allowEmpty: ['notes'],
      }),
    ).toEqual(['vendor', 'missing']);
  });

  it('without exemptions every empty field is a violation', () => {
    expect(emptyViolatingFields({ data: { vendor: null, notes: '' } })).toEqual([
      'vendor',
      'notes',
    ]);
  });

  it('returns nothing when data is null (failed extraction)', () => {
    expect(emptyViolatingFields({ data: null })).toEqual([]);
    expect(emptyViolatingFields({})).toEqual([]);
  });
});

describe('formatConfidence', () => {
  it('renders two decimals', () => {
    expect(formatConfidence(0.9)).toBe('0.90');
    expect(formatConfidence(0.8249)).toBe('0.82');
  });

  it('renders an em dash when there is no score', () => {
    expect(formatConfidence(null)).toBe('—');
    expect(formatConfidence(undefined)).toBe('—');
    expect(formatConfidence(Number.NaN)).toBe('—');
  });
});
