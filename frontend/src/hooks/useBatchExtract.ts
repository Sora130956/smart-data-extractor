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
}

export function useBatchExtract() {
  return useMutation<ExtractionSource[], Error, BatchExtractInput>({
    mutationFn: async ({ texts, preset, schema, instructions, lang, schemaResolveCost, fieldLabels }) => {
      const response = await batchExtract({ texts, preset, schema, instructions, lang });
      return adaptBatchExtractResponse(response, texts, schemaResolveCost, fieldLabels);
    },
  });
}
