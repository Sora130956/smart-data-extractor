import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import type { ExtractionResult } from '@/types/extraction';
import { formatCost } from '@/utils/currency';
import { ConfidenceBar } from './ConfidenceBar';

type TFunction = ReturnType<typeof useTranslation>['t'];

/** main-interface.html .fchip: render each field value as a short chip,
 * prefixed with the field's display label ("姓名：张伟"). Falls back to the
 * raw field key when no label map is available. */
function fieldChip(
  key: string,
  value: unknown,
  fieldLabels: Record<string, string> | undefined,
  t: TFunction,
): string {
  const label = fieldLabels?.[key] ?? key;
  if (value === null || value === undefined) {
    return t('resultRow.nullField', { field: label });
  }
  if (Array.isArray(value)) {
    // Nested records (e.g. invoice line_items) summarize as "field: N items";
    // primitive arrays (e.g. tags) join their values.
    const hasObjects = value.some((v) => v !== null && typeof v === 'object');
    if (hasObjects) {
      return t('resultRow.listField', { field: label, count: value.length });
    }
    return t('resultRow.fieldValue', { label, value: value.map((v) => String(v)).join(', ') });
  }
  if (typeof value === 'object') {
    return t('resultRow.fieldValue', { label, value: JSON.stringify(value) });
  }
  return t('resultRow.fieldValue', { label, value: String(value) });
}

export function ResultRow({
  result,
  label,
  fieldLabels,
  onView,
  onRetry,
}: {
  result: ExtractionResult;
  label: string;
  /** field_name -> display label snapshot from the source. */
  fieldLabels?: Record<string, string>;
  onView?: () => void;
  onRetry?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const cost = formatCost(result.costUsd, result.costCny, i18n.resolvedLanguage ?? 'en');

  if (result.status === 'failed') {
    return (
      <div className="flex items-center gap-3 border-t border-border bg-error/6 px-3.5 py-2.5">
        <span className="w-[62px] flex-none text-caption text-text-muted">{label}</span>
        <span className="flex-1 overflow-hidden text-caption text-error">
          {t('resultRow.failed', { message: result.error })}
        </span>
        <ConfidenceBar value={null} />
        <span className="tnum w-[62px] flex-none text-right text-caption text-text-muted">
          {cost}
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
            {fieldChip(key, value, fieldLabels, t)}
          </span>
        ))}
      </span>
      <ConfidenceBar value={result.avgConfidence} />
      <span className="tnum w-[62px] flex-none text-right text-caption text-text-muted">
        {cost}
      </span>
      <span className="w-16 flex-none text-right">
        <Button size="sm" onClick={onView}>
          {t('resultRow.view')}
        </Button>
      </span>
    </div>
  );
}
