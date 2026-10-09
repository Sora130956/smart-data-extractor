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
  required: z.boolean(),
  // Echoed by /schema/resolve so the UI can label chips per resolved field.
  display_name: z.string().nullable().optional(),
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

export const parsePdfResponseSchema = z.object({
  text: z.string(),
  // Per-page OCR text aligned to the original page order; null marks a failed page.
  pages: z.array(z.string().nullable()),
  pages_failed: z.array(z.number()),
  tokens_used: tokensUsedSchema,
  cost_usd: z.number(),
  cost_cny: z.number(),
});

// /parse_image returns the same shape (one image = one "page").
export const parseImageResponseSchema = parsePdfResponseSchema;

export type TokensUsed = z.infer<typeof tokensUsedSchema>;
export type BatchResultItem = z.infer<typeof batchResultItemSchema>;
export type BatchExtractResponse = z.infer<typeof batchExtractResponseSchema>;
export type PresetFieldDto = z.infer<typeof presetFieldSchema>;
export type PresetSchemaResponse = z.infer<typeof presetSchemaResponseSchema>;
export type PresetListItem = z.infer<typeof presetListItemSchema>;
export type SchemaResolveResponse = z.infer<typeof schemaResolveResponseSchema>;
export type ParsePdfResponse = z.infer<typeof parsePdfResponseSchema>;
export type ParseImageResponse = ParsePdfResponse;
