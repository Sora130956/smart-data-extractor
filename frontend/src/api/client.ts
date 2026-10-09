// Thin fetch wrapper for the extraction API. Kept separate from adapters.ts
// so response-shape mapping never leaks into transport concerns.

import {
  batchExtractResponseSchema,
  parseImageResponseSchema,
  parsePdfResponseSchema,
  presetListResponseSchema,
  presetSchemaResponseSchema,
  schemaResolveResponseSchema,
  type BatchExtractResponse,
  type ParseImageResponse,
  type ParsePdfResponse,
  type PresetListItem,
  type PresetSchemaResponse,
  type SchemaResolveResponse,
} from './schemas';

export class ApiError extends Error {
  readonly status: number;
  /** Structured error code from the backend (e.g. 429 quota codes). */
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * FastAPI error bodies are {"detail": string | {code, message, reset_at}}.
 * Surface the structured fields (so 429 quota responses can be localized,
 * see utils/errors.ts) while keeping plain-text bodies as the message.
 */
async function toApiError(res: Response): Promise<ApiError> {
  const raw = await res.text().catch(() => '');
  let detail = raw;
  let code: string | undefined;
  try {
    const parsed = JSON.parse(raw)?.detail;
    if (typeof parsed === 'string') {
      detail = parsed;
    } else if (parsed && typeof parsed === 'object') {
      if (typeof parsed.message === 'string') detail = parsed.message;
      if (typeof parsed.code === 'string') code = parsed.code;
    }
  } catch {
    // Not JSON — keep the raw body as the message.
  }
  return new ApiError(detail || res.statusText, res.status, code);
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

  if (!res.ok) throw await toApiError(res);

  return batchExtractResponseSchema.parse(await res.json());
}

export async function getPresets(): Promise<PresetListItem[]> {
  const res = await fetch('/api/presets');

  if (!res.ok) throw await toApiError(res);

  return presetListResponseSchema.parse(await res.json());
}

export async function getPresetSchema(preset: string): Promise<PresetSchemaResponse> {
  const res = await fetch(`/api/presets/${preset}/schema`);

  if (!res.ok) throw await toApiError(res);

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

  if (!res.ok) throw await toApiError(res);

  return schemaResolveResponseSchema.parse(await res.json());
}

export async function inferSchema(text: string): Promise<SchemaResolveResponse> {
  const res = await fetch('/api/schema/infer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) throw await toApiError(res);

  return schemaResolveResponseSchema.parse(await res.json());
}

export async function parsePdf(file: File): Promise<ParsePdfResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch('/api/parse_pdf', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) throw await toApiError(res);

  return parsePdfResponseSchema.parse(await res.json());
}

export async function parseImage(file: File): Promise<ParseImageResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch('/api/parse_image', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) throw await toApiError(res);

  return parseImageResponseSchema.parse(await res.json());
}
