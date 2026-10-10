// Review flow helper (issue #1): applying an inline field correction must
// preserve the originally extracted value, not just overwrite it. Shared by
// App's on-screen state and the history store's persisted mirror so both
// stay in sync (same snapshot semantics).
// Also hosts the issue #2 submit-time threshold snapshot builder.

import type { ExtractionResult, SchemaField } from '@/types/extraction';

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

/** Build the issue #2 review-threshold snapshot for a submission: real field
 * name -> configured minimum confidence, keeping only fields that have one.
 *
 * Keys come from the field's own `fieldName` when known. After a
 * /schema/resolve the backend owns the keys, so pass the resolved schema's
 * fields to re-key by `field_name` first and echoed `display_name` second
 * (freshly named fields have no stable key yet). */
export function buildReviewThresholds(
  fields: SchemaField[],
  resolved?: Record<string, { display_name?: string | null }>,
): Record<string, number> {
  const byName = new Map<string, number>();
  const byDisplay = new Map<string, number>();
  for (const field of fields) {
    if (field.minConfidence == null) continue;
    if (field.fieldName) byName.set(field.fieldName, field.minConfidence);
    byDisplay.set(field.displayName, field.minConfidence);
  }
  if (byName.size === 0 && byDisplay.size === 0) return {};

  const thresholds: Record<string, number> = {};
  if (resolved) {
    for (const [key, spec] of Object.entries(resolved)) {
      const value =
        byName.get(key) ??
        (spec.display_name != null ? byDisplay.get(spec.display_name) : undefined);
      if (value !== undefined) thresholds[key] = value;
    }
  } else {
    for (const [key, value] of byName) thresholds[key] = value;
  }
  return thresholds;
}
