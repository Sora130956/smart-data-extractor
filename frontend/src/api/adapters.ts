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
  schemaResolveCost?: { costUsd: number; costCny: number },
  fieldLabels?: Record<string, string>,
  presetLabel?: string,
  fileUrls?: Array<string | undefined>,
  reviewThresholds?: Record<string, number>,
  allowEmptyFields?: string[],
  fileTypes?: Array<'pdf' | 'image' | undefined>,
): ExtractionSource[] {
  // Ids must stay unique across batches: the UI accumulates results from
  // successive extractions, so `text-${i}` alone would collide as a React key.
  const batchId = crypto.randomUUID().slice(0, 8);
  return response.results.map((item, i) => {
    const sourceId = `text-${batchId}-${i}`;
    const result = toResult(item, sourceId);
    const preview = (texts[i] ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
    // Attribute the one-off /schema/resolve cost to the first source only,
    // so it is counted once in the aggregate totals rather than duplicated.
    const isFirst = i === 0;
    const hasThresholds =
      reviewThresholds != null && Object.keys(reviewThresholds).length > 0;
    const hasAllowEmpty = allowEmptyFields != null && allowEmptyFields.length > 0;

    return {
      id: sourceId,
      // Issue #4: real upload kind (pdf/image), text for everything else —
      // the review pane picks its file-preview strategy from this.
      type: fileTypes?.[i] ?? 'text',
      name: `Manual Input ${i + 1}`, // English fallback; UI layer re-labels via i18n
      ordinal: i + 1,
      uploadedAt: new Date().toISOString(),
      meta: preview,
      ...(presetLabel ? { presetLabel } : {}),
      ...(fieldLabels ? { fieldLabels } : {}),
      ...(hasThresholds ? { reviewThresholds } : {}),
      ...(hasAllowEmpty ? { allowEmptyFields } : {}),
      ...(fileUrls?.[i] ? { sourceFileUrl: fileUrls[i] } : {}),
      ...(texts[i] ? { sourceText: texts[i] } : {}),
      results: [result],
      stats: {
        succeeded: result.status === 'success' ? 1 : 0,
        failed: result.status === 'failed' ? 1 : 0,
        totalCostUsd: result.costUsd,
        totalCostCny: result.costCny,
        avgConfidence: result.avgConfidence,
        schemaResolveCostUsd: isFirst ? schemaResolveCost?.costUsd ?? 0 : 0,
        schemaResolveCostCny: isFirst ? schemaResolveCost?.costCny ?? 0 : 0,
      },
    };
  });
}
