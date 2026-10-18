import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import type { ExtractionResult, ExtractionSource } from '@/types/extraction';
import { tableReviewSummary } from '@/utils/table';
import { ResultRow } from './ResultRow';

/** Issue #14: results rendered per page inside one source card. */
export const PAGE_SIZE = 20;

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
  onView?: (result: ExtractionResult, resultIndex: number) => void;
  onRetry?: (resultIndex: number) => void;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);

  const totalPages = Math.max(1, Math.ceil(source.results.length / PAGE_SIZE));
  // Clamp so a shrinking list (filter change, retry) never strands the user
  // on a page that no longer exists.
  const currentPage = Math.min(page, totalPages - 1);
  const start = currentPage * PAGE_SIZE;
  const pageResults = source.results.slice(start, start + PAGE_SIZE);
  let tableSummary: string | undefined;
  if (source.mode === 'table') {
    const s = tableReviewSummary(source.tables);
    tableSummary =
      s.pending > 0
        ? t('table.summary', { tables: s.tables, total: s.cells, pending: s.pending })
        : t('table.summaryDone', { tables: s.tables, total: s.cells });
  }
  return (
    <div className="mx-5 mb-3 overflow-hidden rounded-card border border-border">
      <div className="flex items-center gap-2.5 bg-surface-muted px-3.5 py-2.5">
        <span>{TYPE_ICON[source.type]}</span>
        <span className="text-caption font-semibold">
          {source.type === 'text' && source.ordinal !== undefined
            ? t('source.manualInput', { index: source.ordinal })
            : source.name}
        </span>
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

      {pageResults.map((result, offset) => {
        const i = start + offset;
        return (
          <ResultRow
            key={`${result.sourceId}-${i}`}
            result={result}
            label={source.mode === 'table' ? t('paste.tableMode') : t('paste.itemLabel', { index: i + 1 })}
            fieldLabels={source.fieldLabels}
            summary={tableSummary}
            onView={onView ? () => onView(result, i) : undefined}
            onRetry={onRetry ? () => onRetry(i) : undefined}
          />
        );
      })}

      {totalPages > 1 ? (
        <nav
          aria-label={t('pagination.label')}
          className="flex items-center justify-end gap-2.5 border-t border-border px-3.5 py-2"
        >
          <Button
            size="sm"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            {t('pagination.prev')}
          </Button>
          <span className="text-caption text-text-muted">
            {currentPage + 1} / {totalPages}
          </span>
          <Button
            size="sm"
            disabled={currentPage === totalPages - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            {t('pagination.next')}
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
