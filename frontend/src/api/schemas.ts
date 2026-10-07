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
});

export const schemaResolveResponseSchema = z.object({
  schema: z.object({
    fields: z.record(z.string(), schemaFieldSpecSchema),
  }),
  tokens_used: tokensUsedSchema,
  cost_usd: z.number(),
  cost_cny: z.number(),
});

export type TokensUsed = z.infer<typeof tokensUsedSchema>;
export type BatchResultItem = z.infer<typeof batchResultItemSchema>;
export type BatchExtractResponse = z.infer<typeof batchExtractResponseSchema>;
export type PresetFieldDto = z.infer<typeof presetFieldSchema>;
export type PresetSchemaResponse = z.infer<typeof presetSchemaResponseSchema>;
export type PresetListItem = z.infer<typeof presetListItemSchema>;
export type SchemaResolveResponse = z.infer<typeof schemaResolveResponseSchema>;
