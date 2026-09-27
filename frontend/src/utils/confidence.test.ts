import { describe, expect, it } from 'vitest';
import {
  CONFIDENCE_HIGH,
  CONFIDENCE_LOW,
  confidenceLevel,
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
