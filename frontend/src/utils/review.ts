// Review flow helper (issue #1): applying an inline field correction must
// preserve the originally extracted value, not just overwrite it. Shared by
// App's on-screen state and the history store's persisted mirror so both
// stay in sync (same snapshot semantics).

import type { ExtractionResult } from '@/types/extraction';

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
