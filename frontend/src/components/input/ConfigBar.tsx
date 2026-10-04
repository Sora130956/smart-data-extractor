import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { SchemaEditor } from '@/components/input/SchemaEditor';
import { useUiStore } from '@/store/uiStore';
import type { PresetId } from '@/types/extraction';

const PRESETS: PresetId[] = ['contact', 'invoice', 'lead'];

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
  const { t } = useTranslation();
  const { preset, instructions, setPreset, setInstructions } = useUiStore();

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
          {PRESETS.map((p) => (
            <option key={p} value={p}>
              {`${t('config.preset')}: ${t(`config.preset${p.charAt(0).toUpperCase()}${p.slice(1)}`)}`}
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
