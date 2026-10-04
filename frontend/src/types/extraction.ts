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
  results: ExtractionResult[];
  stats: {
    succeeded: number;
    failed: number;
    totalCostUsd: number;
    totalCostCny: number;
    avgConfidence: number;
  };
}

export interface SchemaField {
  name: string;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'array' | 'object';
  description: string;
}

export type PresetId = 'contact' | 'invoice' | 'lead';
export type ExtractionMode = 'preset' | 'custom';
export type ResultFilter = 'all' | 'high' | 'review';
