// Thin fetch wrapper for the extraction API. Kept separate from adapters.ts
// so response-shape mapping never leaks into transport concerns.

import {
  batchExtractResponseSchema,
  presetSchemaResponseSchema,
  type BatchExtractResponse,
  type PresetSchemaResponse,
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

export async function getPresetSchema(preset: string): Promise<PresetSchemaResponse> {
  const res = await fetch(`/api/presets/${preset}/schema`);

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new ApiError(detail || res.statusText, res.status);
  }

  return presetSchemaResponseSchema.parse(await res.json());
}
