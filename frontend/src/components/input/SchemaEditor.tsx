// Inline field-table editor for the selected preset's schema (D-F06):
// editing any field implicitly switches the submit path to custom schema,
// so there is no separate Mode toggle to maintain.

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { usePresetSchema } from '@/hooks/usePresetSchema';
import { useUiStore, SMART_PRESET_ID } from '@/store/uiStore';
import { DEFAULT_MIN_CONFIDENCE, formatConfidence } from '@/utils/confidence';
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

/** Issue #2: the min-confidence column is a preset-tier select
 * (Strict 0.95 / Moderate 0.85 / Balanced 0.70 / Lenient 0.5 / Allow empty 0)
 * instead of a free numeric input, so non-expert users never have to invent
 * a number. Tier values anchor on the on-screen confidence legend
 * (高 ≥ 0.85, 中 0.70–0.85): Moderate 0.85 is the default selection — the
 * High boundary — so unconfigured fields are held to "high" by default.
 * The Allow-empty tier is a plain 0.0 threshold: the backend zeroes a null
 * field's confidence, so empty values sail under 0.0 — one mental model, no
 * separate "allow empty" column to fight with the threshold. */
const MIN_CONFIDENCE_TIERS: ReadonlyArray<{ value: number; labelKey: string }> = [
  { value: 0.95, labelKey: 'schema.minConfidenceStrict' },
  { value: 0.85, labelKey: 'schema.minConfidenceModerate' },
  { value: 0.7, labelKey: 'schema.minConfidenceBalanced' },
  { value: 0.5, labelKey: 'schema.minConfidenceLenient' },
  { value: 0, labelKey: 'schema.minConfidenceEmpty' },
];

/** Unconfigured (null) fields display the default tier — Moderate 0.85,
 * which fieldThreshold falls back to; anything else maps to itself. */
function tierSelectValue(minConfidence: number | null | undefined): string {
  if (minConfidence == null) return String(DEFAULT_MIN_CONFIDENCE);
  return String(minConfidence);
}

/** Values saved by the old free-numeric input (e.g. 0.75) are not tiers;
 * keep them visible as their own option until the user picks a tier. */
function isLegacyConfidence(minConfidence: number | null | undefined): minConfidence is number {
  return (
    minConfidence != null &&
    !MIN_CONFIDENCE_TIERS.some((tier) => tier.value === minConfidence)
  );
}

export function SchemaEditor() {
  const { t } = useTranslation();
  const {
    preset,
    customFields,
    isSchemaModified,
    savedSchemas,
    presetOverrides,
    setCustomFields,
    resetToPreset,
    updateSavedSchema,
    savePresetOverride,
    clearPresetOverride,
  } = useUiStore();
  const isSavedSchema = savedSchemas.some((s) => s.id === preset);
  const isSmart = preset === SMART_PRESET_ID;
  const isBackendPreset = !isSmart && !isSavedSchema;
  // The user's saved edits to this backend preset, if any.
  const override = isBackendPreset ? presetOverrides[preset] : undefined;
  const { data: presetFields, isLoading } = usePresetSchema(preset, {
    enabled: isBackendPreset,
  });

  // Seed the editable field set from the preset's schema, preferring the
  // user's saved override. Runs again after a preset switch (setPreset clears
  // customFields) or a language switch (queryKey includes the language), as
  // long as the user has no edits. Skipped for "smart" (no schema until
  // extraction runs) and for saved schemas (ConfigBar's onChange already
  // seeded customFields for those).
  useEffect(() => {
    const seed = override ?? presetFields;
    if (seed && !isSchemaModified && isBackendPreset) {
      resetToPreset(seed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetFields, preset, override]);

  function updateField(index: number, patch: Partial<SchemaField>) {
    setCustomFields(customFields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function removeField(index: number) {
    setCustomFields(customFields.filter((_, i) => i !== index));
  }

  function addField() {
    setCustomFields([...customFields, { displayName: '', fieldName: null, type: 'string', description: '' }]);
  }

  /** Reset discards the saved override too, so the preset returns to its
   * backend baseline (not to a previously saved local edit). */
  function handleReset() {
    clearPresetOverride(preset);
    if (presetFields) resetToPreset(presetFields);
  }

  function handleSave() {
    if (isSavedSchema) {
      updateSavedSchema(preset, customFields);
      resetToPreset(customFields);
    } else {
      savePresetOverride(preset, customFields);
    }
  }

  if (isLoading && !override) {
    return <div className="mt-3 text-caption text-text-muted">{t('schema.loading')}</div>;
  }

  if (isSmart && customFields.length === 0) {
    return (
      <div className="mt-3 rounded-card border border-border p-3 text-caption text-text-muted">
        {t('schema.smartEmpty')}
      </div>
    );
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
        {!isSmart ? (
          <Button
            size="sm"
            variant="primary"
            onClick={handleSave}
            disabled={!isSchemaModified}
          >
            {t('schema.save')}
          </Button>
        ) : null}
        {isBackendPreset ? (
          <Button size="sm" onClick={handleReset} disabled={!isSchemaModified && !override}>
            {t('schema.resetToPreset')}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-caption font-semibold text-text-muted">
          <span className="w-[140px] flex-none">{t('schema.fieldName')}</span>
          <span className="w-[110px] flex-none">{t('schema.fieldType')}</span>
          <span className="w-[120px] flex-none">{t('schema.minConfidence')}</span>
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
            <select
              aria-label={t('schema.minConfidence')}
              className={`${cellClass} w-[120px] flex-none`}
              value={tierSelectValue(field.minConfidence)}
              onChange={(e) => updateField(i, { minConfidence: Number(e.target.value) })}
            >
              {MIN_CONFIDENCE_TIERS.map((tier) => (
                <option key={tier.labelKey} value={String(tier.value)}>
                  {t(tier.labelKey)}
                </option>
              ))}
              {isLegacyConfidence(field.minConfidence) ? (
                <option value={String(field.minConfidence)}>
                  {formatConfidence(field.minConfidence)}
                </option>
              ) : null}
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
