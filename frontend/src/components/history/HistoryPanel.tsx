import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useHistoryStore, type HistoryEntry } from '@/store/historyStore';
import { formatCost } from '@/utils/currency';

/** Aggregates a history entry's sources for the row summary line. */
function entrySummary(entry: HistoryEntry) {
  return entry.sources.reduce(
    (acc, s) => ({
      succeeded: acc.succeeded + s.stats.succeeded,
      failed: acc.failed + s.stats.failed,
      costUsd: acc.costUsd + s.stats.totalCostUsd + s.stats.schemaResolveCostUsd,
      costCny: acc.costCny + s.stats.totalCostCny + s.stats.schemaResolveCostCny,
    }),
    { succeeded: 0, failed: 0, costUsd: 0, costCny: 0 },
  );
}

/** Modal listing localStorage-persisted extraction batches. Clicking a row
 * restores that batch into the main result list (prepended, newest first). */
export function HistoryPanel({
  onClose,
  onRestore,
}: {
  onClose: () => void;
  onRestore: (entry: HistoryEntry) => void;
}) {
  const { t, i18n } = useTranslation();
  const entries = useHistoryStore((s) => s.entries);
  const clear = useHistoryStore((s) => s.clear);
  const language = i18n.resolvedLanguage ?? 'en';

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('history.title')}
        className="max-h-[90vh] w-full max-w-[560px] overflow-y-auto rounded-card border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4.5 py-3.5">
          <div className="text-title font-semibold">{t('history.title')}</div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label={t('history.close')}
            className="text-text-muted hover:text-text"
          >
            ✕
          </button>
        </div>

        {entries.length === 0 ? (
          <p className="px-4.5 py-8 text-center text-caption text-text-muted">
            {t('history.empty')}
          </p>
        ) : (
          <ul className="flex flex-col">
            {entries.map((entry) => {
              const summary = entrySummary(entry);
              return (
                <li key={entry.id} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    onClick={() => onRestore(entry)}
                    className="flex w-full flex-col gap-1 px-4.5 py-3 text-left transition-colors hover:bg-surface-muted"
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-body font-semibold">{entry.presetLabel}</span>
                      {summary.failed > 0 ? (
                        <span className="rounded-full bg-error/15 px-2 py-0.5 text-caption text-error">
                          {t('resultRow.badgeFailed', { count: summary.failed })}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-caption text-text-muted">
                      {new Date(entry.savedAt).toLocaleString(language)}
                      {' · '}
                      {t('history.sourcesCount', { count: entry.sources.length })}
                      {' · '}
                      {t('resultRow.badgeOk', { count: summary.succeeded })}
                      {' · '}
                      {formatCost(summary.costUsd, summary.costCny, language)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex items-center gap-2 border-t border-border px-4.5 py-3.5">
          <Button
            size="sm"
            disabled={entries.length === 0}
            onClick={clear}
          >
            {t('history.clear')}
          </Button>
          <div className="flex-1" />
          <Button size="sm" onClick={onClose}>
            {t('history.close')}
          </Button>
        </div>
      </div>
    </div>
  );
}
