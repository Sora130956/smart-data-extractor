// Data model — DESIGN.md §4. Kept independent of any API wire shape;
// the adapter layer (F2) maps backend responses onto these types.

export type SourceType = 'pdf' | 'image' | 'text';
export type ResultStatus = 'success' | 'failed';

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
  /** field_name -> localized display label, snapshotted at submit time so
   * chips stay labeled with the schema that produced them. */
  fieldLabels?: Record<string, string>;
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
  /** Preset fields only: baseline for the needsResolve diff. */
  originalDisplayName?: string;
  originalDescription?: string;
}

export type PresetId = string;
export type ExtractionMode = 'preset' | 'custom';
export type ResultFilter = 'all' | 'high' | 'review';

/** A schema the user saved locally, either from the "smart" inference flow
 * or (in the future) some other source. Persisted to localStorage. */
export interface SavedSchema {
  id: string;
  name: string;
  fields: SchemaField[];
  createdAt: string;
}
