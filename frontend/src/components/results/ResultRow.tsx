import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import type { ExtractionResult } from '@/types/extraction';
import { ConfidenceBar } from './ConfidenceBar';

/** main-interface.html .fchip: render each field value as a short chip. */
function fieldChip(
  key: string,
  value: unknown,
  nullLabel: string,
  listLabel: string,
): string {
  if (value === null || value === undefined) return nullLabel.replace('{{field}}', key);
  if (Array.isArray(value)) {
    // Nested records (e.g. invoice line_items) summarize as "field: N items";
    // primitive arrays (e.g. tags) join their values.
    const hasObjects = value.some((v) => v !== null && typeof v === 'object');
    if (hasObjects) {
      return listLabel.replace('{{field}}', key).replace('{{count}}', String(value.length));
    }
    return value.map((v) => String(v)).join(', ');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function ResultRow({
  result,
  label,
  onView,
  onRetry,
}: {
  result: ExtractionResult;
  label: string;
  onView?: () => void;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();

  if (result.status === 'failed') {
    return (
      <div className="flex items-center gap-3 border-t border-border bg-error/6 px-3.5 py-2.5">
        <span className="w-[62px] flex-none text-caption text-text-muted">{label}</span>
        <span className="flex-1 overflow-hidden text-caption text-error">
          {t('resultRow.failed', { message: result.error })}
        </span>
        <ConfidenceBar value={null} />
        <span className="tnum w-[62px] flex-none text-right text-caption text-text-muted">
          ${result.costUsd.toFixed(4)}
        </span>
        <span className="w-16 flex-none text-right">
          <Button size="sm" onClick={onRetry}>
            {t('resultRow.retry')}
          </Button>
        </span>
      </div>
    );
  }

  const entries = Object.entries(result.data ?? {});

  return (
    <div className="flex items-center gap-3 border-t border-border px-3.5 py-2.5">
      <span className="w-[62px] flex-none text-caption text-text-muted">{label}</span>
      <span className="flex flex-1 flex-wrap gap-1.5 overflow-hidden">
        {entries.map(([key, value]) => (
          <span
            key={key}
            className="whitespace-nowrap rounded-token border border-border bg-surface-muted px-2 py-0.5 text-caption"
          >
            {fieldChip(key, value, t('resultRow.nullField'), t('resultRow.listField'))}
          </span>
        ))}
      </span>
      <ConfidenceBar value={result.avgConfidence} />
      <span className="tnum w-[62px] flex-none text-right text-caption text-text-muted">
        ${result.costUsd.toFixed(4)}
      </span>
      <span className="w-16 flex-none text-right">
        <Button size="sm" onClick={onView}>
          {t('resultRow.view')}
        </Button>
      </span>
    </div>
  );
}
