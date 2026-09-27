import { useTranslation } from 'react-i18next';
import type { ExtractionSource } from '@/types/extraction';
import { ResultRow } from './ResultRow';

const TYPE_ICON: Record<ExtractionSource['type'], string> = {
  pdf: '📄',
  image: '🖼️',
  text: '📝',
};

/** main-interface.html .group / .group-head: one collapsible source card. */
export function SourceGroup({
  source,
  onView,
  onRetry,
}: {
  source: ExtractionSource;
  onView?: (resultIndex: number) => void;
  onRetry?: (resultIndex: number) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="mx-5 mb-3 overflow-hidden rounded-card border border-border">
      <div className="flex items-center gap-2.5 bg-surface-muted px-3.5 py-2.5">
        <span>{TYPE_ICON[source.type]}</span>
        <span className="text-caption font-semibold">{source.name}</span>
        {source.meta ? (
          <span className="text-caption text-text-muted">· {source.meta}</span>
        ) : null}
        <span className="flex-1" />
        {source.stats.succeeded > 0 ? (
          <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-caption text-success">
            {t('resultRow.badgeOk', { count: source.stats.succeeded })}
          </span>
        ) : null}
        {source.stats.failed > 0 ? (
          <span className="rounded-full bg-error/15 px-2.5 py-0.5 text-caption text-error">
            {t('resultRow.badgeFailed', { count: source.stats.failed })}
          </span>
        ) : null}
      </div>

      {source.results.map((result, i) => (
        <ResultRow
          key={`${result.sourceId}-${i}`}
          result={result}
          label={t('paste.itemLabel', { index: i + 1 })}
          onView={onView ? () => onView(i) : undefined}
          onRetry={onRetry ? () => onRetry(i) : undefined}
        />
      ))}
    </div>
  );
}
