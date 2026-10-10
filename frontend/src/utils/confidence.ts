// Confidence banding — DESIGN.md §4. Single source of truth: no component
// may hardcode 0.85 / 0.70 or re-derive a level on its own.

export const CONFIDENCE_HIGH = 0.85;
export const CONFIDENCE_LOW = 0.7;

/** User-configured per-field minimum confidences, keyed by field name
 * (issue #2). Absent fields fall back to DEFAULT_MIN_CONFIDENCE. */
export type ReviewThresholds = Record<string, number>;

/** Issue #2 default per-field minimum confidence (user-set): the High band
 * boundary — 高 ≥ 0.85 in the on-screen legend — so unconfigured fields are
 * held to "high" by default and the tier options share the legend's numbers.
 * The Medium band (0.70–0.85) stays a display band; the aggregate review
 * bar below stays at CONFIDENCE_LOW (需复核 < 0.70). */
export const DEFAULT_MIN_CONFIDENCE = CONFIDENCE_HIGH;

/** The minimum confidence a field must clear: its configured threshold
 * (issue #2) or the default minimum. */
export function fieldThreshold(field: string, thresholds?: ReviewThresholds): number {
  return thresholds?.[field] ?? DEFAULT_MIN_CONFIDENCE;
}

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export function confidenceLevel(value: number): ConfidenceLevel {
  if (value >= CONFIDENCE_HIGH) return 'high';
  if (value >= CONFIDENCE_LOW) return 'medium';
  return 'low';
}

/** An extraction value that counts as "empty": null, missing, or an empty
 * string. Numbers and booleans (0 / false) are real values, never empty. */
export function isEmptyValue(value: unknown): boolean {
  return value == null || value === '';
}

/** Issue #2 allow-empty — empty fields flagged for review. An empty field
 * carries no quality signal (the backend zeroes its confidence), so it is
 * judged by this rule alone, never by a confidence threshold. */
export function emptyViolatingFields(input: {
  data?: Record<string, unknown> | null;
  allowEmpty?: string[];
}): string[] {
  if (input.data == null) return [];
  const allow = new Set(input.allowEmpty ?? []);
  return Object.entries(input.data)
    .filter(([field, value]) => isEmptyValue(value) && !allow.has(field))
    .map(([field]) => field);
}

/** Fields under their own minimum confidence, with the threshold each was
 * judged against — drives the needs-review warning list. When `data` is
 * available, empty fields are excluded: they are judged by the allow-empty
 * rule instead, so a zeroed confidence never masquerades as a quality miss. */
export function belowThresholdFields(input: {
  confidence: Record<string, number>;
  thresholds?: ReviewThresholds;
  data?: Record<string, unknown> | null;
}): Array<{ field: string; threshold: number }> {
  return Object.entries(input.confidence)
    .filter(([field, value]) => {
      if (input.data != null && isEmptyValue(input.data[field])) return false;
      return value < fieldThreshold(field, input.thresholds);
    })
    .map(([field]) => ({ field, threshold: fieldThreshold(field, input.thresholds) }));
}

/** §8.4 + issue #2 — Need Review = aggregate below LOW, any single field
 * below its configured minimum confidence (default DEFAULT_MIN_CONFIDENCE),
 * or any field that came back empty while its schema does not allow it. */
export function needsReview(input: {
  avgConfidence: number;
  confidence: Record<string, number>;
  thresholds?: ReviewThresholds;
  data?: Record<string, unknown> | null;
  allowEmpty?: string[];
}): boolean {
  if (input.avgConfidence < CONFIDENCE_LOW) return true;
  if (emptyViolatingFields(input).length > 0) return true;
  return belowThresholdFields(input).length > 0;
}

/** Always show the number: colour alone must never carry the signal (§7). */
export function formatConfidence(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toFixed(2);
}
