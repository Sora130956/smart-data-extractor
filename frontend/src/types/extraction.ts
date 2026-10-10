// Data model — DESIGN.md §4. Kept independent of any API wire shape;
// the adapter layer (F2) maps backend responses onto these types.

export type SourceType = 'pdf' | 'image' | 'text';
export type ResultStatus = 'success' | 'failed';

/** Where an extracted value sits in the original file (D-027): a
 * normalized 0-100 bounding box, plus the 0-based page index it was found
 * on (null = single-image sources, which have no paging). */
export interface FieldBox {
  page: number | null;
  box: [number, number, number, number];
}

export interface ExtractionResult {
  sourceId: string;
  /** Human-facing position inside the source: "Page 1" | "Item 2". */
  index: string;
  status: ResultStatus;
  data: Record<string, unknown> | null;
  /** Per-field confidence, keyed by field name. */
  confidence: Record<string, number>;
  /** Aggregate used by the result row. */
  avgConfidence: number;
  tokensUsed: { input: number; output: number };
  costUsd: number;
  /** Display currency, converted server-side from costUsd. */
  costCny: number;
  error?: string;
  /** field_name -> true once the user has manually reviewed/edited it. */
  reviewedFields?: Record<string, boolean>;
  /** field_name -> value as originally extracted, snapshotted right before
   * the FIRST user edit of that field (re-edits keep the first snapshot).
   * Fields never edited have no entry — their original value is still in
   * `data`. Lets exports compare the LLM's answer with the correction. */
  originalData?: Record<string, unknown>;
}

export interface ExtractionSource {
  id: string;
  type: SourceType;
  /** File name, or a translated label for pasted text (see ordinal). */
  name: string;
  /** 1-based position among pasted text blocks; drives the i18n label. */
  ordinal?: number;
  uploadedAt: string;
  /** "15 pages" | "OCR processed" */
  meta?: string;
  /** Display name of the template (preset or saved schema) that produced
   * this source, snapshotted at submit time — used for export filenames. */
  presetLabel?: string;
  /** field_name -> localized display label, snapshotted at submit time so
   * chips stay labeled with the schema that produced them. */
  fieldLabels?: Record<string, string>;
  /** field_name -> user-configured minimum confidence, snapshotted at submit
   * time (issue #2) so later schema edits never re-flag old batches. Absent
   * when no field had a configured threshold. */
  reviewThresholds?: Record<string, number>;
  /** Keys of fields the user explicitly marked "may be empty", snapshotted at
   * submit time (issue #2 allow-empty). Absent when nothing was marked — the
   * default keeps flagging empty values for review, as before the feature. */
  allowEmptyFields?: string[];
  /** Blob URL for the original uploaded file (pdf/image), session-scoped. */
  sourceFileUrl?: string;
  /** Full input text snapshotted at submit time (pasted text, .txt content,
   * or the OCR text for pdf/image) — the review pane (issue #4) matches
   * extracted values against it to highlight where they came from. Unlike
   * `meta` (a 60-char preview) it is never clipped. */
  sourceText?: string;
  /** Per-page base64 PNG renders of the original PDF (D-027) — the review
   * pane overlays locate boxes on these page images instead of an iframe.
   * Session-scoped like `sourceFileUrl`; stripped from persisted history
   * (heavy base64 payloads would blow the localStorage quota). */
  pageImages?: string[];
  /** field_name -> where its value sits in the original file (D-027),
   * cached from the /locate_fields call so re-opening the detail modal
   * does not re-bill the vision model. Session-scoped: restored history
   * entries have no file to render boxes on, so it is not persisted. */
  fieldBoxes?: Record<string, FieldBox>;
  results: ExtractionResult[];
  stats: {
    succeeded: number;
    failed: number;
    totalCostUsd: number;
    totalCostCny: number;
    avgConfidence: number;
    /** LLM cost of resolving custom field names for this submission, if any. */
    schemaResolveCostUsd: number;
    schemaResolveCostCny: number;
  };
}

export interface SchemaField {
  /** User-facing label, shown/edited in the SchemaEditor. */
  displayName: string;
  /** English label from the preset; passed to /schema/resolve when present. */
  displayNameEn?: string | null;
  /** Real LLM schema key; null until /schema/resolve assigns one. */
  fieldName: string | null;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'date';
  description: string;
  /** User-configured minimum confidence for this field (issue #2), in [0, 1].
   * null/undefined = use the global default (CONFIDENCE_LOW); 0 = the
   * "Allow empty" tier — empty and low-confidence values never flag review.
   * Frontend-only: never sent to the backend, it does not change the LLM
   * schema. */
  minConfidence?: number | null;
  /** Preset fields only: baseline for the needsResolve diff. */
  originalDisplayName?: string;
  originalDescription?: string;
}

export type PresetId = string;
export type ExtractionMode = 'preset' | 'custom';
export type ResultFilter = 'all' | 'high' | 'review' | 'reviewed';

/** A schema the user saved locally, either from the "smart" inference flow
 * or (in the future) some other source. Persisted to localStorage. */
export interface SavedSchema {
  id: string;
  /** Chinese / text-language name (the AI's schema_name for smart inference). */
  name: string;
  /** English name (the AI's schema_name_en); absent in legacy entries. */
  nameEn?: string;
  fields: SchemaField[];
  createdAt: string;
}
