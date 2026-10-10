// Confidence banding — DESIGN.md §4. Single source of truth: no component
// may hardcode 0.85 / 0.70 or re-derive a level on its own.

export const CONFIDENCE_HIGH = 0.85;
export const CONFIDENCE_LOW = 0.7;

/** User-configured per-field minimum confidences, keyed by field name
 * (issue #2). Absent fields fall back to CONFIDENCE_LOW. */
export type ReviewThresholds = Record<string, number>;

export function fieldThreshold(field: string, thresholds?: ReviewThresholds): number {
  return thresholds?.[field] ?? CONFIDENCE_LOW;
}

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export function confidenceLevel(value: number): ConfidenceLevel {
  if (value >= CONFIDENCE_HIGH) return 'high';
  if (value >= CONFIDENCE_LOW) return 'medium';
  return 'low';
}

/** Fields under their own minimum confidence, with the threshold each was
 * judged against — drives the needs-review warning list. */
export function belowThresholdFields(input: {
  confidence: Record<string, number>;
  thresholds?: ReviewThresholds;
}): Array<{ field: string; threshold: number }> {
  return Object.entries(input.confidence)
    .filter(([field, value]) => value < fieldThreshold(field, input.thresholds))
    .map(([field]) => ({ field, threshold: fieldThreshold(field, input.thresholds) }));
}

/** §8.4 + issue #2 — Need Review = aggregate below LOW, or any single field
 * below its configured minimum confidence (default LOW). */
export function needsReview(input: {
  avgConfidence: number;
  confidence: Record<string, number>;
  thresholds?: ReviewThresholds;
}): boolean {
  if (input.avgConfidence < CONFIDENCE_LOW) return true;
  return belowThresholdFields(input).length > 0;
}

/** Always show the number: colour alone must never carry the signal (§7). */
export function formatConfidence(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toFixed(2);
}
