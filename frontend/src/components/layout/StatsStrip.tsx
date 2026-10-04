import { useTranslation } from 'react-i18next';
import { formatConfidence } from '@/utils/confidence';
import { formatCost } from '@/utils/currency';

export interface BatchStats {
  sources: number;
  extracted: number;
  failed: number;
  /** null until at least one result exists. */
  avgConfidence: number | null;
  totalCostUsd: number;
  totalCostCny: number;
}

export const EMPTY_STATS: BatchStats = {
  sources: 0,
  extracted: 0,
  failed: 0,
  avgConfidence: null,
  totalCostUsd: 0,
  totalCostCny: 0,
};

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'success' | 'error';
}) {
  const toneClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'error'
        ? 'text-error'
        : 'text-text';

  return (
    <div className="border-r border-border px-5 py-3.5 last:border-r-0">
      <div className="text-caption text-text-muted">{label}</div>
      <div className={`tnum mt-0.5 text-title font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

export function StatsStrip({ stats = EMPTY_STATS }: { stats?: BatchStats }) {
  const { t, i18n } = useTranslation();

  return (
    <div className="grid grid-cols-2 border-b border-border sm:grid-cols-3 lg:grid-cols-5">
      <Stat label={t('stats.sources')} value={String(stats.sources)} />
      <Stat
        label={t('stats.extracted')}
        value={String(stats.extracted)}
        tone={stats.extracted > 0 ? 'success' : 'neutral'}
      />
      <Stat
        label={t('stats.failed')}
        value={String(stats.failed)}
        tone={stats.failed > 0 ? 'error' : 'neutral'}
      />
      <Stat label={t('stats.avgConfidence')} value={formatConfidence(stats.avgConfidence)} />
      <Stat
        label={t('stats.totalCost')}
        value={formatCost(stats.totalCostUsd, stats.totalCostCny, i18n.resolvedLanguage ?? 'en')}
      />
    </div>
  );
}
