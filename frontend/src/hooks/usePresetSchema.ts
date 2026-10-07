// Wraps GET /presets/{name}/schema in a TanStack Query query. Used by
// SchemaEditor to show the selected preset's field structure.

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getPresetSchema } from '@/api/client';
import type { SchemaField } from '@/types/extraction';

export function usePresetSchema(preset: string) {
  // useTranslation (not the i18n singleton) so a language switch re-renders
  // and the lang in the queryKey busts the cached previous-language fields.
  const { i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'en';
  const isZh = lang.startsWith('zh');

  return useQuery<SchemaField[], Error>({
    queryKey: ['preset-schema', preset, lang],
    queryFn: async () => {
      const response = await getPresetSchema(preset);
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
