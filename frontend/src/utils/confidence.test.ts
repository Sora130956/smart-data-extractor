import { describe, expect, it } from 'vitest';
import {
  CONFIDENCE_HIGH,
  CONFIDENCE_LOW,
  belowThresholdFields,
  confidenceLevel,
  fieldThreshold,
  formatConfidence,
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

  it('passes when the aggregate and every field clear the low threshold', () => {
    expect(
      needsReview({ avgConfidence: 0.88, confidence: { a: 0.92, b: 0.71 } }),
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

  it('falls back to the global default for fields without a configured threshold', () => {
    expect(
      needsReview({
        avgConfidence: 0.9,
        confidence: { vendor: 0.85, total: 0.69 },
        thresholds: { vendor: 0.9 },
      }),
    ).toBe(true); // total has no entry -> still judged against 0.70
  });
});

describe('fieldThreshold', () => {
  it('returns the configured threshold for the field', () => {
    expect(fieldThreshold('vendor', { vendor: 0.9 })).toBe(0.9);
  });

  it('falls back to the global default when absent', () => {
    expect(fieldThreshold('vendor', { total: 0.9 })).toBe(CONFIDENCE_LOW);
    expect(fieldThreshold('vendor', undefined)).toBe(CONFIDENCE_LOW);
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

  it('judges unconfigured fields against the global default', () => {
    expect(
      belowThresholdFields({ confidence: { vendor: 0.69, total: 0.95 } }),
    ).toEqual([{ field: 'vendor', threshold: CONFIDENCE_LOW }]);
  });

  it('returns an empty list when every field clears its threshold', () => {
    expect(
      belowThresholdFields({ confidence: { a: 0.99 }, thresholds: { a: 0.5 } }),
    ).toEqual([]);
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
