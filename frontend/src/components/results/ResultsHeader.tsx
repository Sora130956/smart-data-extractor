import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useUiStore } from '@/store/uiStore';
import type { ExtractionSource, ResultFilter } from '@/types/extraction';

export interface FilterCounts {
  all: number;
  high: number;
  review: number;
}

export const EMPTY_COUNTS: FilterCounts = { all: 0, high: 0, review: 0 };

function Chip({
  label,
  count,
  active,
  warn = false,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  warn?: boolean;
  onClick: () => void;
}) {
  const idle = warn
    ? 'border-warning text-warning hover:bg-warning/10'
    : 'border-border text-text-muted hover:bg-surface-muted';

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-3 py-0.5 text-caption transition-colors ${
        active ? 'border-brand bg-brand text-on-brand' : `bg-surface ${idle}`
      }`}
    >
      <span>{label}</span>
      <span className="tnum ml-1">({count})</span>
    </button>
  );
}

export function ResultsHeader({
  counts = EMPTY_COUNTS,
  sources = [],
}: {
  counts?: FilterCounts;
  sources?: ExtractionSource[];
}) {
  const { t } = useTranslation();
  const filter = useUiStore((s) => s.filter);
  const setFilter = useUiStore((s) => s.setFilter);

  function handleExportAll() {
    const blob = new Blob([JSON.stringify(sources, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'extraction-results.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  const chips: Array<{ id: ResultFilter; label: string; count: number; warn?: boolean }> = [
    { id: 'all', label: t('results.filterAll'), count: counts.all },
    { id: 'high', label: t('results.filterHigh'), count: counts.high },
    { id: 'review', label: t('results.filterReview'), count: counts.review, warn: true },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 px-5 pt-4 pb-3">
      <h2 className="mr-1 text-title font-semibold">{t('results.title')}</h2>

      {chips.map((chip) => (
        <Chip
          key={chip.id}
          label={chip.label}
          count={chip.count}
          warn={chip.warn}
          active={filter === chip.id}
          onClick={() => setFilter(chip.id)}
        />
      ))}

      <div className="flex-1" />

      <Button size="sm" disabled={counts.all === 0} onClick={handleExportAll}>
        {t('results.exportJson')}
      </Button>
      <Button size="sm" disabled>
        {t('results.exportExcel')}
      </Button>
    </div>
  );
}
