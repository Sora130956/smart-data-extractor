// Wraps POST /batch_extract in a TanStack Query mutation. Consumers get
// back UI-ready ExtractionSource[] — wire mapping is fully hidden here.

import { useMutation } from '@tanstack/react-query';
import { adaptBatchExtractResponse } from '@/api/adapters';
import { batchExtract } from '@/api/client';
import type { ExtractionSource } from '@/types/extraction';

export interface BatchExtractInput {
  texts: string[];
  preset?: string;
  schema?: Record<string, unknown>;
  instructions?: string;
  /** UI language tag, forwarded so preset descriptions follow the locale. */
  lang?: string;
  /** Cost of the /schema/resolve call that produced `schema`, if any. */
  schemaResolveCost?: { costUsd: number; costCny: number };
  /** field_name -> display label snapshot for chip rendering. */
  fieldLabels?: Record<string, string>;
  /** Display name of the template that produced this batch (export filenames). */
  presetLabel?: string;
  /** Per-text Blob URL for the original uploaded file, if any (session-scoped). */
  fileUrls?: Array<string | undefined>;
  /** Upload kind of each fileUrl ('pdf' | 'image'), aligned by index —
   * the review pane (issue #4) picks its preview strategy from it. */
  fileTypes?: Array<'pdf' | 'image' | undefined>;
  /** field_name -> user-configured minimum confidence, snapshotted onto each
   * source so review flags survive later schema edits (issue #2). */
  reviewThresholds?: Record<string, number>;
  /** Keys of fields the user explicitly marked "may be empty", snapshotted
   * onto each source (issue #2 allow-empty). */
  allowEmptyFields?: string[];
}

export function useBatchExtract() {
  return useMutation<ExtractionSource[], Error, BatchExtractInput>({
    mutationFn: async ({ texts, preset, schema, instructions, lang, schemaResolveCost, fieldLabels, presetLabel, fileUrls, fileTypes, reviewThresholds, allowEmptyFields }) => {
      const response = await batchExtract({ texts, preset, schema, instructions, lang });
      return adaptBatchExtractResponse(response, texts, schemaResolveCost, fieldLabels, presetLabel, fileUrls, reviewThresholds, allowEmptyFields, fileTypes);
    },
  });
}
