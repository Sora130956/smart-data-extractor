import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { SchemaEditor } from '@/components/input/SchemaEditor';
import { getPresets } from '@/api/client';
import { useUiStore } from '@/store/uiStore';
import type { PresetId } from '@/types/extraction';

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
  const { preset, instructions, setPreset, setInstructions } = useUiStore();
  const { data: presets } = useQuery({ queryKey: ['presets'], queryFn: getPresets });
  const isZh = (i18n.resolvedLanguage ?? 'en') === 'zh';

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
          onChange={(e) => setPreset(e.target.value as PresetId)}
        >
          {(presets ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {`${t('config.preset')}: ${isZh ? p.display_name_zh : p.display_name_en}`}
            </option>
          ))}
        </select>

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

      <SchemaEditor />
    </div>
  );
}
