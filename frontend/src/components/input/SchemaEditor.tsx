// Inline field-table editor for the selected preset's schema (D-F06):
// editing any field implicitly switches the submit path to custom schema,
// so there is no separate Mode toggle to maintain.

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { usePresetSchema } from '@/hooks/usePresetSchema';
import { useUiStore } from '@/store/uiStore';
import type { SchemaField } from '@/types/extraction';

const FIELD_TYPES: SchemaField['type'][] = [
  'string',
  'number',
  'integer',
  'boolean',
  'date',
];

const cellClass =
  'rounded-token border border-border bg-surface px-2 py-1 text-caption text-text';

export function SchemaEditor() {
  const { t } = useTranslation();
  const { preset, customFields, isSchemaModified, setCustomFields, resetToPreset } = useUiStore();
  const { data: presetFields, isLoading } = usePresetSchema(preset);

  // Seed the editable field set from the preset's schema. Runs again after
  // a preset switch (setPreset clears customFields) or a language switch
  // (queryKey includes the language), as long as the user has no edits.
  useEffect(() => {
    if (presetFields && !isSchemaModified) {
      resetToPreset(presetFields);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetFields, preset]);

  function updateField(index: number, patch: Partial<SchemaField>) {
    setCustomFields(customFields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function removeField(index: number) {
    setCustomFields(customFields.filter((_, i) => i !== index));
  }

  function addField() {
    setCustomFields([...customFields, { displayName: '', fieldName: null, type: 'string', description: '' }]);
  }

  function handleReset() {
    if (presetFields) resetToPreset(presetFields);
  }

  if (isLoading) {
    return <div className="mt-3 text-caption text-text-muted">{t('schema.loading')}</div>;
  }

  return (
    <div className="mt-3 rounded-card border border-border p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-caption font-semibold text-text-muted">{t('schema.title')}</span>
        {isSchemaModified ? (
          <span className="rounded-token bg-accent/15 px-1.5 py-0.5 text-caption text-accent">
            {t('schema.modified')}
          </span>
        ) : null}
        <div className="flex-1" />
        <Button size="sm" onClick={handleReset} disabled={!isSchemaModified}>
          {t('schema.resetToPreset')}
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-caption font-semibold text-text-muted">
          <span className="w-[140px] flex-none">{t('schema.fieldName')}</span>
          <span className="w-[110px] flex-none">{t('schema.fieldType')}</span>
          <span className="flex-1">{t('schema.fieldDescription')}</span>
          <span className="w-[20px] flex-none" />
        </div>
        {customFields.map((field, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              aria-label={t('schema.fieldName')}
              className={`${cellClass} w-[140px] flex-none`}
              value={field.displayName}
              onChange={(e) => updateField(i, { displayName: e.target.value })}
            />
            <select
              aria-label={t('schema.fieldType')}
              className={`${cellClass} w-[110px] flex-none`}
              value={field.type}
              onChange={(e) => updateField(i, { type: e.target.value as SchemaField['type'] })}
            >
              {FIELD_TYPES.map((ft) => (
                <option key={ft} value={ft}>
                  {t(`schema.type.${ft}`)}
                </option>
              ))}
            </select>
            <input
              aria-label={t('schema.fieldDescription')}
              className={`${cellClass} flex-1`}
              value={field.description}
              onChange={(e) => updateField(i, { description: e.target.value })}
            />
            <button
              type="button"
              aria-label={`${t('schema.removeField')} ${field.displayName || i + 1}`}
              onClick={() => removeField(i)}
              className="flex-none rounded-token px-1 text-caption text-text-muted hover:text-error"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <Button size="sm" className="mt-2" onClick={addField}>
        {t('schema.addField')}
      </Button>
    </div>
  );
}
