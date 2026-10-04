// Maps the raw /batch_extract wire response onto the UI's Source/Result
// model (types/extraction.ts). F2 constraint: one pasted text == one Source
// == exactly one Result (the 1:1 special case of the general 1:N model).

import type { BatchExtractResponse, BatchResultItem } from './schemas';
import type { ExtractionResult, ExtractionSource } from '@/types/extraction';

const CONFIDENCE_SUFFIX = '_confidence';

/** Split a raw data dict into plain fields + a confidence-only map. */
function splitConfidence(
  data: Record<string, unknown> | null,
): { fields: Record<string, unknown>; confidence: Record<string, number> } {
  const fields: Record<string, unknown> = {};
  const confidence: Record<string, number> = {};
  if (!data) return { fields, confidence };

  for (const [key, value] of Object.entries(data)) {
    if (key.endsWith(CONFIDENCE_SUFFIX) && typeof value === 'number') {
      confidence[key.slice(0, -CONFIDENCE_SUFFIX.length)] = value;
    } else {
      fields[key] = value;
    }
  }
  return { fields, confidence };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function toResult(item: BatchResultItem, sourceId: string): ExtractionResult {
  const { fields, confidence } = splitConfidence(item.data);
  const avgConfidence = average(Object.values(confidence));

  return {
    sourceId,
    index: '1',
    status: item.error === null ? 'success' : 'failed',
    data: item.error === null ? fields : null,
    confidence,
    avgConfidence,
    tokensUsed: { input: item.tokens_used.input, output: item.tokens_used.output },
    costUsd: item.cost_usd,
    costCny: item.cost_cny,
    ...(item.error !== null ? { error: item.error } : {}),
  };
}

/**
 * Build one ExtractionSource per pasted text block, in the same order the
 * texts were submitted (the backend preserves request order in `results`).
 */
export function adaptBatchExtractResponse(
  response: BatchExtractResponse,
  texts: string[],
): ExtractionSource[] {
  return response.results.map((item, i) => {
    const sourceId = `text-${i}`;
    const result = toResult(item, sourceId);
    const preview = (texts[i] ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);

    return {
      id: sourceId,
      type: 'text',
      name: `Manual Input ${i + 1}`, // English fallback; UI layer re-labels via i18n
      ordinal: i + 1,
      uploadedAt: new Date().toISOString(),
      meta: preview,
      results: [result],
      stats: {
        succeeded: result.status === 'success' ? 1 : 0,
        failed: result.status === 'failed' ? 1 : 0,
        totalCostUsd: result.costUsd,
        totalCostCny: result.costCny,
        avgConfidence: result.avgConfidence,
      },
    };
  });
}
