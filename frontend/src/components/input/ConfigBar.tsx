import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useUiStore } from '@/store/uiStore';
import type { ExtractionMode, PresetId } from '@/types/extraction';

const PRESETS: PresetId[] = ['contact', 'invoice', 'lead'];
const MODES: ExtractionMode[] = ['preset', 'custom'];

const selectClass =
  'rounded-token border border-border bg-surface px-2.5 py-1.5 text-body text-text';

export function ConfigBar({ canStart = false }: { canStart?: boolean }) {
  const { t } = useTranslation();
  const { mode, preset, instructions, setMode, setPreset, setInstructions } = useUiStore();

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2.5">
      <label className="sr-only" htmlFor="mode">
        {t('config.mode')}
      </label>
      <select
        id="mode"
        className={selectClass}
        value={mode}
        onChange={(e) => setMode(e.target.value as ExtractionMode)}
      >
        {MODES.map((m) => (
          <option key={m} value={m}>
            {`${t('config.mode')}: ${t(m === 'preset' ? 'config.modePreset' : 'config.modeCustom')}`}
          </option>
        ))}
      </select>

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

      <Button variant="primary" disabled={!canStart}>
        {t('config.start')}
      </Button>
    </div>
  );
}
