// Wraps GET /presets/{name}/schema in a TanStack Query query. Used by
// SchemaEditor to show the selected preset's field structure.

import { useQuery } from '@tanstack/react-query';
import { getPresetSchema } from '@/api/client';
import i18n from '@/i18n';
import type { SchemaField } from '@/types/extraction';

export function usePresetSchema(preset: string) {
  return useQuery<SchemaField[], Error>({
    queryKey: ['preset-schema', preset],
    queryFn: async () => {
      const response = await getPresetSchema(preset);
      const isZh = (i18n.resolvedLanguage ?? 'en') === 'zh';
      return response.fields.map((f) => ({
        displayName: isZh ? f.display_name_zh : f.display_name_en,
        displayNameEn: f.display_name_en,
        fieldName: f.field_name,
        type: f.type as SchemaField['type'],
        description: f.description ?? '',
        originalDisplayName: isZh ? f.display_name_zh : f.display_name_en,
        originalDescription: f.description ?? '',
      }));
    },
  });
}
