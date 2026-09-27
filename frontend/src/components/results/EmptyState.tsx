import { useTranslation } from 'react-i18next';
import { CONFIDENCE_HIGH, CONFIDENCE_LOW } from '@/utils/confidence';
import { ConfidenceBar } from './ConfidenceBar';

/**
 * §8.8 — the empty state gives direction, not an empty table.
 * It also teaches the confidence banding before any data arrives, since that
 * signal is what the user will read all day.
 */
export function EmptyState() {
  const { t } = useTranslation();

  const legend = [
    { value: 0.92, label: t('confidence.high'), hint: `≥ ${CONFIDENCE_HIGH.toFixed(2)}` },
    {
      value: 0.76,
      label: t('confidence.medium'),
      hint: `${CONFIDENCE_LOW.toFixed(2)} – ${CONFIDENCE_HIGH.toFixed(2)}`,
    },
    { value: 0.58, label: t('confidence.low'), hint: `< ${CONFIDENCE_LOW.toFixed(2)}` },
  ];

  return (
    <div className="mx-5 mb-5 rounded-card border border-dashed border-border px-5 py-7">
      <p className="text-title font-semibold">{t('results.emptyTitle')}</p>
      <p className="mt-1 max-w-2xl text-caption text-text-muted">{t('results.emptyBody')}</p>

      <ul className="mt-5 flex flex-col gap-2 border-t border-border pt-4">
        {legend.map((item) => (
          <li key={item.label} className="flex items-center gap-3">
            <ConfidenceBar value={item.value} />
            <span className="text-caption">{item.label}</span>
            <span className="tnum text-caption text-text-muted">{item.hint}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
