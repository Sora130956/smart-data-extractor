// Thin fetch wrapper for the extraction API. Kept separate from adapters.ts
// so response-shape mapping never leaks into transport concerns.

import {
  batchExtractResponseSchema,
  presetListResponseSchema,
  presetSchemaResponseSchema,
  schemaResolveResponseSchema,
  type BatchExtractResponse,
  type PresetListItem,
  type PresetSchemaResponse,
  type SchemaResolveResponse,
} from './schemas';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export interface BatchExtractParams {
  texts: string[];
  preset?: string;
  schema?: Record<string, unknown>;
  instructions?: string;
  /** UI language tag: preset field descriptions sent to the LLM follow it. */
  lang?: string;
}

export async function batchExtract(
  params: BatchExtractParams,
): Promise<BatchExtractResponse> {
  const body: Record<string, unknown> = { texts: params.texts };
  if (params.schema) {
    body.schema = params.schema;
  } else {
    body.preset = params.preset;
  }
  if (params.instructions) body.instructions = params.instructions;
  if (params.lang) body.lang = params.lang;

  const res = await fetch('/api/batch_extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new ApiError(detail || res.statusText, res.status);
  }

  return batchExtractResponseSchema.parse(await res.json());
}

export async function getPresets(): Promise<PresetListItem[]> {
  const res = await fetch('/api/presets');

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new ApiError(detail || res.statusText, res.status);
  }

  return presetListResponseSchema.parse(await res.json());
}

export async function getPresetSchema(preset: string): Promise<PresetSchemaResponse> {
  const res = await fetch(`/api/presets/${preset}/schema`);

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new ApiError(detail || res.statusText, res.status);
  }

  return presetSchemaResponseSchema.parse(await res.json());
}

export interface SchemaResolveFieldParams {
  display_name: string;
  description: string;
  type: string;
  required?: boolean;
  field_name?: string;
}

export async function resolveSchema(
  fields: SchemaResolveFieldParams[],
): Promise<SchemaResolveResponse> {
  const res = await fetch('/api/schema/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new ApiError(detail || res.statusText, res.status);
  }

  return schemaResolveResponseSchema.parse(await res.json());
}
