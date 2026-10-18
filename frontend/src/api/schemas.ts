// Wire-level DTOs — mirrors src/smart_data_extractor/api/schemas.py.
// Validated at the network boundary so a backend contract drift fails loudly
// here instead of silently corrupting the UI.

import { z } from 'zod';

export const tokensUsedSchema = z.object({
  input: z.number(),
  output: z.number(),
});

export const batchResultItemSchema = z.object({
  data: z.record(z.string(), z.unknown()).nullable(),
  tokens_used: tokensUsedSchema,
  cost_usd: z.number(),
  cost_cny: z.number(),
  error: z.string().nullable(),
  // D-046: per-field OCR fusion evidence; null when no OCR input was sent.
  confidence_signals: z.record(z.string(), z.record(z.string(), z.unknown())).nullish(),
});

export const batchExtractResponseSchema = z.object({
  results: z.array(batchResultItemSchema),
  total_cost_usd: z.number(),
  total_cost_cny: z.number(),
  total_tokens: tokensUsedSchema,
  succeeded: z.number(),
  failed: z.number(),
});

export const presetFieldSchema = z.object({
  field_name: z.string(),
  display_name_zh: z.string(),
  display_name_en: z.string(),
  type: z.string(),
  format: z.string().nullable(),
  description_zh: z.string().nullable(),
  description_en: z.string().nullable(),
});

export const presetSchemaResponseSchema = z.object({
  fields: z.array(presetFieldSchema),
});

export const presetListItemSchema = z.object({
  id: z.string(),
  display_name_zh: z.string(),
  display_name_en: z.string(),
  is_builtin: z.boolean(),
});

export const presetListResponseSchema = z.array(presetListItemSchema);

export const schemaFieldSpecSchema = z.object({
  type: z.string(),
  description: z.string().nullable(),
  // /schema/infer only: English translation of the description.
  description_en: z.string().nullable().optional(),
  required: z.boolean(),
  // Echoed by /schema/resolve and /schema/infer so the UI can label chips in
  // the current language (text-language name plus its English translation).
  display_name: z.string().nullable().optional(),
  display_name_en: z.string().nullable().optional(),
});

export const schemaResolveResponseSchema = z.object({
  schema: z.object({
    fields: z.record(z.string(), schemaFieldSpecSchema),
  }),
  // /schema/infer only: AI-generated name for the inferred schema, in the
  // input text's language plus English. Used to name the saved template.
  schema_name: z.string().nullable().optional(),
  schema_name_en: z.string().nullable().optional(),
  tokens_used: tokensUsedSchema,
  cost_usd: z.number(),
  cost_cny: z.number(),
});

// One OCR grounding block (D-028): a text line/phrase plus its bounding box
// normalized to 0-100 (percentages of the page image).
export const ocrBlockSchema = z.object({
  text: z.string(),
  box: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});

// One hand_write OCR row (D-046).
export const ocrLineSchema = z.object({
  page: z.number(),
  text: z.string(),
  box: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  min_prob: z.number(),
});

const ocrCellBoxSchema = z.object({
  page: z.number(),
  box: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});

// One table cell (table mode): top-left position + spans, matched OCR row
// confidence (null = no signal) and bounding box.
export const ocrTableCellSchema = z.object({
  row: z.number(),
  col: z.number(),
  rowspan: z.number(),
  colspan: z.number(),
  text: z.string(),
  is_header: z.boolean(),
  confidence: z.number().nullable(),
  bbox: ocrCellBoxSchema.nullable(),
  needs_review: z.boolean(),
  edited: z.boolean(),
});

export const ocrTableSchema = z.object({
  page: z.number(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  rows: z.number(),
  cols: z.number(),
  cells: z.array(ocrTableCellSchema),
});

export const parsePdfResponseSchema = z.object({
  // 'table' when the page is mostly a table; tables then carries the cells.
  mode: z.enum(['table', 'fields']).optional(),
  tables: z.array(ocrTableSchema).nullish(),
  text: z.string(),
  // D-046: row-level OCR confidence (hand_write interface). Echoed back to
  // /batch_extract for confidence fusion; null/absent when disabled/failed.
  ocr_lines: z.array(ocrLineSchema).nullish(),
  // Per-page OCR text aligned to the original page order; null marks a failed page.
  pages: z.array(z.string().nullable()),
  // Per-page OCR grounding blocks (D-028), aligned with `pages` — the review
  // pane matches extracted values against them locally. Optional/null: pages
  // without coordinate info and older backends omit it.
  pages_blocks: z.array(z.array(ocrBlockSchema).nullable()).nullish(),
  pages_failed: z.array(z.number()),
  // Per-page base64 PNG renders (D-027) — the review pane overlays grounding
  // boxes on them. Optional/null: image parsing and older backends omit it.
  pages_images: z.array(z.string()).nullish(),
  tokens_used: tokensUsedSchema,
  cost_usd: z.number(),
  cost_cny: z.number(),
});

// /parse_image returns the same shape (one image = one "page").
export const parseImageResponseSchema = parsePdfResponseSchema;

// POST /feedback: delivery receipt.
export const feedbackResponseSchema = z.object({
  ok: z.boolean(),
});

export type TokensUsed = z.infer<typeof tokensUsedSchema>;
export type BatchResultItem = z.infer<typeof batchResultItemSchema>;
export type BatchExtractResponse = z.infer<typeof batchExtractResponseSchema>;
export type PresetFieldDto = z.infer<typeof presetFieldSchema>;
export type PresetSchemaResponse = z.infer<typeof presetSchemaResponseSchema>;
export type PresetListItem = z.infer<typeof presetListItemSchema>;
export type SchemaResolveResponse = z.infer<typeof schemaResolveResponseSchema>;
export type ParsePdfResponse = z.infer<typeof parsePdfResponseSchema>;
export type ParseImageResponse = ParsePdfResponse;
export type FeedbackResponse = z.infer<typeof feedbackResponseSchema>;
