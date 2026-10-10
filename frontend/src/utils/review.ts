// Review flow helper (issue #1): applying an inline field correction must
// preserve the originally extracted value, not just overwrite it. Shared by
// App's on-screen state and the history store's persisted mirror so both
// stay in sync (same snapshot semantics).
// Also hosts the issue #2 submit-time snapshots: per-field review thresholds
// and the allow-empty field list.

import type { ExtractionResult, ExtractionSource, SchemaField } from '@/types/extraction';
import { belowThresholdFields, emptyViolatingFields, needsReview } from './confidence';

/** Issue #3 per-result review status, see `reviewState`. */
export type ReviewState = 'none' | 'pending' | 'reviewed';

/** Returns a new result with the field corrected and marked reviewed.
 * The pre-edit value is snapshotted into `originalData` on the first edit
 * of the field; later edits keep that first snapshot. Pure — no mutation. */
export function applyFieldEdit(
  result: ExtractionResult,
  fieldKey: string,
  newValue: unknown,
): ExtractionResult {
  const previous = result.originalData;
  const alreadySnapshotted =
    previous != null && Object.prototype.hasOwnProperty.call(previous, fieldKey);
  const originalData = alreadySnapshotted
    ? previous
    : { ...previous, [fieldKey]: result.data?.[fieldKey] ?? null };
  return {
    ...result,
    data: { ...result.data, [fieldKey]: newValue },
    originalData,
    reviewedFields: { ...result.reviewedFields, [fieldKey]: true },
  };
}

/** Shared re-keying for the issue #2 submit-time snapshots: collect the
 * fields passing `keep`, then map them onto the keys the backend owns.
 * Keys come from the field's own `fieldName` when known. After a
 * /schema/resolve the backend owns the keys, so `resolved` re-keys by
 * `field_name` first and echoed `display_name` second (freshly named
 * fields have no stable key yet). */
function keyedFields(
  fields: SchemaField[],
  keep: (field: SchemaField) => boolean,
  resolved?: Record<string, { display_name?: string | null }>,
): Array<[string, SchemaField]> {
  const byName = new Map<string, SchemaField>();
  const byDisplay = new Map<string, SchemaField>();
  for (const field of fields) {
    if (!keep(field)) continue;
    if (field.fieldName) byName.set(field.fieldName, field);
    byDisplay.set(field.displayName, field);
  }
  if (byName.size === 0 && byDisplay.size === 0) return [];

  if (resolved) {
    const out: Array<[string, SchemaField]> = [];
    for (const [key, spec] of Object.entries(resolved)) {
      const field =
        byName.get(key) ??
        (spec.display_name != null ? byDisplay.get(spec.display_name) : undefined);
      if (field) out.push([key, field]);
    }
    return out;
  }
  return [...byName.entries()];
}

/** Build the issue #2 review-threshold snapshot for a submission: real field
 * name -> configured minimum confidence, keeping only fields that have one. */
export function buildReviewThresholds(
  fields: SchemaField[],
  resolved?: Record<string, { display_name?: string | null }>,
): Record<string, number> {
  const thresholds: Record<string, number> = {};
  for (const [key, field] of keyedFields(fields, (f) => f.minConfidence != null, resolved)) {
    thresholds[key] = field.minConfidence as number;
  }
  return thresholds;
}

/** Build the issue #2 allow-empty snapshot for a submission: the keys of the
 * fields whose tier is "Allow empty" (minConfidence 0). A null field's
 * confidence is zeroed by the backend, so empty values sail under a 0.0
 * threshold; the snapshot feeds the empty-value rule on the consumer side.
 * Fields on any other tier default to NOT allowed, which keeps flagging
 * empty values exactly as before the feature existed. */
export function buildAllowEmptyFields(
  fields: SchemaField[],
  resolved?: Record<string, { display_name?: string | null }>,
): string[] {
  return keyedFields(fields, (f) => f.minConfidence === 0, resolved).map(([key]) => key);
}

/** Issue #3 — the fields that triggered review for a result: those below
 * their own minimum confidence ∪ those that came back empty while their
 * schema does not allow it. Empty fields only ever appear in `empty` —
 * their zeroed confidence carries no quality signal. */
export function problemFields(
  result: Pick<ExtractionResult, 'confidence' | 'data'>,
  source: Pick<ExtractionSource, 'reviewThresholds' | 'allowEmptyFields'>,
): { belowThreshold: Array<{ field: string; threshold: number }>; empty: string[] } {
  return {
    belowThreshold: belowThresholdFields({
      confidence: result.confidence,
      thresholds: source.reviewThresholds,
      data: result.data,
    }),
    empty: emptyViolatingFields({
      data: result.data,
      allowEmpty: source.allowEmptyFields,
    }),
  };
}

/** Issue #3 three-state review status — the single source of truth shared by
 * the filter counts, the filter predicate, and the detail modal banner:
 * - 'none': healthy success, nothing to review (the High Confidence bucket)
 * - 'pending': review needed and not all problem fields are reviewed yet
 *   (failed items always land here — they have no fields to review)
 * - 'reviewed': every problem field has been manually reviewed
 * The order of the checks is the semantics: failed first keeps failed items
 * out of 'none' exactly as before; an item flagged ONLY by the aggregate
 * average rule has no problem fields and can never transition to 'reviewed'. */
export function reviewState(
  result: Pick<
    ExtractionResult,
    'status' | 'avgConfidence' | 'confidence' | 'data' | 'reviewedFields'
  >,
  source: Pick<ExtractionSource, 'reviewThresholds' | 'allowEmptyFields'>,
): ReviewState {
  if (result.status === 'failed') return 'pending';
  if (
    !needsReview({
      avgConfidence: result.avgConfidence,
      confidence: result.confidence,
      thresholds: source.reviewThresholds,
      data: result.data,
      allowEmpty: source.allowEmptyFields,
    })
  ) {
    return 'none';
  }
  const problems = problemFields(result, source);
  const flagged = new Set<string>([
    ...problems.belowThreshold.map((p) => p.field),
    ...problems.empty,
  ]);
  // Aggregate-only flag: nothing to review, so it can never clear.
  if (flagged.size === 0) return 'pending';
  for (const field of flagged) {
    if (result.reviewedFields?.[field] !== true) return 'pending';
  }
  return 'reviewed';
}
