import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useUiStore } from '@/store/uiStore';
import { exportToExcel } from '@/utils/excelExport';
import { buildExportFilename } from '@/utils/exportFilename';
import type { ExtractionSource, ResultFilter } from '@/types/extraction';

export interface FilterCounts {
  all: number;
  high: number;
  review: number;
  reviewed: number;
}

export const EMPTY_COUNTS: FilterCounts = { all: 0, high: 0, review: 0, reviewed: 0 };

function Chip({
  label,
  count,
  active,
  tone = 'default',
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  tone?: 'default' | 'warn' | 'success';
  onClick: () => void;
}) {
  const idle =
    tone === 'warn'
      ? 'border-warning text-warning hover:bg-warning/10'
      : tone === 'success'
        ? 'border-success text-success hover:bg-success/10'
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
    a.download = buildExportFilename(exportLabel(), 'json');
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExportExcel() {
    void exportToExcel(sources, buildExportFilename(exportLabel(), 'xlsx'), t);
  }

  /** Newest batch first: its template label names the export. Older sources
   * without a snapshot (restored history) fall back to the source name. */
  function exportLabel(): string {
    return sources[0]?.presetLabel ?? sources[0]?.name ?? 'extraction-results';
  }

  const chips: Array<{ id: ResultFilter; label: string; count: number; tone?: 'warn' | 'success' }> = [
    { id: 'all', label: t('results.filterAll'), count: counts.all },
    { id: 'high', label: t('results.filterHigh'), count: counts.high },
    { id: 'review', label: t('results.filterReview'), count: counts.review, tone: 'warn' },
    // Issue #3: items whose every problem field has been reviewed.
    { id: 'reviewed', label: t('results.filterReviewed'), count: counts.reviewed, tone: 'success' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 px-5 pt-4 pb-3">
      <h2 className="mr-1 text-title font-semibold">{t('results.title')}</h2>

      {chips.map((chip) => (
        <Chip
          key={chip.id}
          label={chip.label}
          count={chip.count}
          tone={chip.tone}
          active={filter === chip.id}
          onClick={() => setFilter(chip.id)}
        />
      ))}

      <div className="flex-1" />

      <Button size="sm" disabled={counts.all === 0} onClick={handleExportAll}>
        {t('results.exportJson')}
      </Button>
      <Button size="sm" disabled={counts.all === 0} onClick={handleExportExcel}>
        {t('results.exportExcel')}
      </Button>
    </div>
  );
}
