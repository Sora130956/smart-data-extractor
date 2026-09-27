// Confidence banding — DESIGN.md §4. Single source of truth: no component
// may hardcode 0.85 / 0.70 or re-derive a level on its own.

export const CONFIDENCE_HIGH = 0.85;
export const CONFIDENCE_LOW = 0.7;

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export function confidenceLevel(value: number): ConfidenceLevel {
  if (value >= CONFIDENCE_HIGH) return 'high';
  if (value >= CONFIDENCE_LOW) return 'medium';
  return 'low';
}

/** §8.4 — Need Review = aggregate below LOW, or any single field below LOW. */
export function needsReview(input: {
  avgConfidence: number;
  confidence: Record<string, number>;
}): boolean {
  if (input.avgConfidence < CONFIDENCE_LOW) return true;
  return Object.values(input.confidence).some((v) => v < CONFIDENCE_LOW);
}

/** Always show the number: colour alone must never carry the signal (§7). */
export function formatConfidence(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toFixed(2);
}
