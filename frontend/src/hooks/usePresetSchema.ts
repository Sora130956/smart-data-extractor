// Wraps GET /presets/{name}/schema in a TanStack Query query. Used by
// SchemaEditor to show the selected preset's field structure.

import { useQuery } from '@tanstack/react-query';
import { getPresetSchema } from '@/api/client';
import type { SchemaField } from '@/types/extraction';

export function usePresetSchema(preset: string) {
  return useQuery<SchemaField[], Error>({
    queryKey: ['preset-schema', preset],
    queryFn: async () => {
      const response = await getPresetSchema(preset);
      return response.fields.map((f) => ({
        displayName: f.name,
        fieldName: f.name,
        type: f.type as SchemaField['type'],
        description: f.description ?? '',
        originalDisplayName: f.name,
        originalDescription: f.description ?? '',
      }));
    },
  });
}
