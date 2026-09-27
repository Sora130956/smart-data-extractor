// Wraps POST /batch_extract in a TanStack Query mutation. Consumers get
// back UI-ready ExtractionSource[] — wire mapping is fully hidden here.

import { useMutation } from '@tanstack/react-query';
import { adaptBatchExtractResponse } from '@/api/adapters';
import { batchExtract } from '@/api/client';
import type { ExtractionSource } from '@/types/extraction';

export interface BatchExtractInput {
  texts: string[];
  preset: string;
  instructions?: string;
}

export function useBatchExtract() {
  return useMutation<ExtractionSource[], Error, BatchExtractInput>({
    mutationFn: async ({ texts, preset, instructions }) => {
      const response = await batchExtract({ texts, preset, instructions });
      return adaptBatchExtractResponse(response, texts);
    },
  });
}
