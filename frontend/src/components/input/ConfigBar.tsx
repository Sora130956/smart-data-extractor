import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { SchemaEditor } from '@/components/input/SchemaEditor';
import { ManageSchemasPanel } from '@/components/input/ManageSchemasPanel';
import { getPresets } from '@/api/client';
import { useUiStore, SMART_PRESET_ID } from '@/store/uiStore';

const selectClass =
  'rounded-token border border-border bg-surface px-2.5 py-1.5 text-body text-text';

export function ConfigBar({
  canStart = false,
  isLoading = false,
  onStart,
}: {
  canStart?: boolean;
  isLoading?: boolean;
  onStart?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { preset, instructions, savedSchemas, setPreset, setInstructions, setCustomFields } =
    useUiStore();
  const [isManageOpen, setManageOpen] = useState(false);
  const {
    data: presets,
    isPending: presetsLoading,
    isError: presetsError,
  } = useQuery({ queryKey: ['presets'], queryFn: getPresets });
  const isZh = (i18n.resolvedLanguage ?? 'en').startsWith('zh');

  function handlePresetChange(value: string) {
    setPreset(value);
    const saved = savedSchemas.find((s) => s.id === value);
    if (saved) setCustomFields(saved.fields);
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="sr-only" htmlFor="preset">
          {t('config.preset')}
        </label>
        <select
          id="preset"
          className={selectClass}
          value={preset}
          disabled={presetsLoading || presetsError}
          onChange={(e) => handlePresetChange(e.target.value)}
        >
          {presetsLoading ? (
            <option value={preset}>{t('config.presetsLoading')}</option>
          ) : presetsError ? (
            <option value={preset}>{preset}</option>
          ) : (
            <>
              {(presets ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {isZh ? p.display_name_zh : p.display_name_en}
                </option>
              ))}
              <option value={SMART_PRESET_ID}>{`${t('config.smartPreset')} ✨`}</option>
              {savedSchemas.length > 0 ? (
                <optgroup label={t('config.mySchemas')}>
                  {savedSchemas.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </>
          )}
        </select>

        <button
          type="button"
          onClick={() => setManageOpen(true)}
          aria-label={t('config.manageSchemas')}
          className="rounded-token border border-border bg-surface px-2 py-1.5 text-caption text-text-muted hover:text-text"
        >
          {t('config.manageSchemas')}
        </button>

        <input
          type="text"
          className={`${selectClass} w-full sm:w-[280px]`}
          placeholder={t('config.instructions')}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />

        <div className="flex-1" />

        <Button variant="primary" disabled={!canStart || isLoading} onClick={onStart}>
          {isLoading ? t('config.starting') : t('config.start')}
        </Button>
      </div>

      {presetsError ? (
        <p className="mt-2 text-caption text-error">{t('config.presetsError')}</p>
      ) : null}

      <SchemaEditor />

      {isManageOpen ? <ManageSchemasPanel onClose={() => setManageOpen(false)} /> : null}
    </div>
  );
}
