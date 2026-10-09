import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import type { ExtractionResult, ExtractionSource } from '@/types/extraction';
import {
  CONFIDENCE_LOW,
  confidenceLevel,
  formatConfidence,
  needsReview,
  type ConfidenceLevel,
} from '@/utils/confidence';
import { formatCost } from '@/utils/currency';
import { exportToExcel } from '@/utils/excelExport';
import { buildExportFilename } from '@/utils/exportFilename';

type TFunction = ReturnType<typeof useTranslation>['t'];

const BADGE: Record<ConfidenceLevel, string> = {
  high: 'bg-success/15 text-success',
  medium: 'bg-warning/15 text-warning',
  low: 'bg-error/15 text-error',
};

/** Mirrors ResultRow's fieldChip value rendering, minus the "label: " prefix
 * (the label already has its own column here). */
function formatFieldValue(value: unknown, t: TFunction) {
  if (value === null || value === undefined) {
    return <span className="italic text-text-muted">{t('resultDetail.nullValue')}</span>;
  }
  if (Array.isArray(value)) {
    const hasObjects = value.some((v) => v !== null && typeof v === 'object');
    if (hasObjects) return t('resultDetail.itemsCount', { count: value.length });
    return value.map((v) => String(v)).join(', ');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Only scalar fields are user-editable; arrays/objects stay read-only. */
function isEditableValue(value: unknown): boolean {
  return value == null || typeof value !== 'object';
}

export interface ResultDetailModalProps {
  source: ExtractionSource;
  result: ExtractionResult;
  /** Human-readable item label, e.g. "Text 1" — result.index is not
   * guaranteed to be meaningful (currently always "1" from the adapter). */
  label: string;
  onClose: () => void;
  /** Reports an inline field edit (review flow). Marks the field reviewed. */
  onFieldUpdate?: (fieldKey: string, newValue: unknown) => void;
}

export function ResultDetailModal({ source, result, label, onClose, onFieldUpdate }: ResultDetailModalProps) {
  const { t, i18n } = useTranslation();
  const [copied, setCopied] = useState(false);
  // Inline editing: key of the field being edited + its working value.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const entries = Object.entries(result.data ?? {});
  const nullCount = entries.filter(([, v]) => v === null || v === undefined).length;
  const reviewFields = Object.entries(result.confidence)
    .filter(([, v]) => v < CONFIDENCE_LOW)
    .map(([key]) => source.fieldLabels?.[key] ?? key);
  const cost = formatCost(result.costUsd, result.costCny, i18n.resolvedLanguage ?? 'en');

  function startEdit(key: string, value: unknown) {
    setEditing(key);
    setDraft(value == null ? '' : String(value));
  }

  /** Saves the draft: empty means null; numbers stay numeric. */
  function commitEdit(key: string, rawValue: unknown) {
    if (!onFieldUpdate) return;
    let next: unknown = draft;
    if (draft === '') next = null;
    else if (typeof rawValue === 'number' && draft.trim() !== '' && !Number.isNaN(Number(draft))) {
      next = Number(draft);
    }
    onFieldUpdate(key, next);
    setEditing(null);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable (e.g. insecure context); nothing to recover.
    }
  }

  function handleExport() {
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = buildExportFilename(source.presetLabel ?? source.name, 'json');
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExportExcel() {
    void exportToExcel(
      [{ ...source, results: [result] }],
      buildExportFilename(source.presetLabel ?? source.name, 'xlsx'),
      t,
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[90vh] w-full max-w-[680px] overflow-y-auto rounded-card border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4.5 py-3.5">
          <div>
            <div className="text-title font-semibold">{t('resultDetail.title', { index: label })}</div>
            <div className="text-caption text-text-muted">
              {source.name}
              {source.meta ? ` · ${source.meta}` : ''}
            </div>
          </div>
          <div className="flex-1" />
          {source.sourceFileUrl ? (
            <a
              href={source.sourceFileUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-token border border-border bg-surface px-2.5 py-1 text-caption font-medium text-text transition-colors hover:bg-surface-muted"
            >
              <span>
                <Trans i18nKey="resultDetail.openOriginal" components={{ br: <br /> }} />
              </span>
            </a>
          ) : null}
          <Button size="sm" onClick={handleCopy}>
            {copied ? t('resultDetail.copied') : t('resultDetail.copyJson')}
          </Button>
          <Button size="sm" onClick={handleExport}>
            {t('resultDetail.exportJson')}
          </Button>
          <Button size="sm" onClick={handleExportExcel}>
            {t('resultDetail.exportExcel')}
          </Button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('resultDetail.close')}
            className="text-text-muted hover:text-text"
          >
            ✕
          </button>
        </div>

        {needsReview(result) && (
          <div className="mx-4.5 mt-3.5 flex items-start gap-2 rounded-token border border-warning bg-warning/12 px-3 py-2.5 text-caption">
            <span>⚠️</span>
            <span>
              {t('resultDetail.needsReviewWarning', {
                count: reviewFields.length,
                threshold: formatConfidence(CONFIDENCE_LOW),
                fields: reviewFields.join(', '),
              })}
            </span>
          </div>
        )}

        <div className="mx-4.5 mt-3.5 overflow-hidden rounded-card border border-border">
          {entries.map(([key, value]) => {
            const confidence = result.confidence[key];
            const level = confidence === undefined ? null : confidenceLevel(confidence);
            const fieldLabel = source.fieldLabels?.[key] ?? key;
            const reviewed = result.reviewedFields?.[key] === true;
            return (
              <div
                key={key}
                className="flex items-start gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0"
              >
                <span className="w-[140px] flex-none text-caption text-text-muted">
                  {fieldLabel}
                </span>
                {editing === key ? (
                  typeof value === 'boolean' ? (
                    <input
                      type="checkbox"
                      checked={value}
                      onChange={() => {
                        onFieldUpdate?.(key, !value);
                        setEditing(null);
                      }}
                      className="mt-0.5"
                    />
                  ) : (
                    <input
                      value={draft}
                      autoFocus
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commitEdit(key, value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitEdit(key, value);
                        } else if (e.key === 'Escape') {
                          // Escape cancels the edit, not the whole dialog.
                          e.stopPropagation();
                          setEditing(null);
                        }
                      }}
                      className="flex-1 rounded-token border border-brand bg-surface px-2 py-1 text-caption outline-none"
                    />
                  )
                ) : (
                  <>
                    <span className="flex-1 break-words text-caption">{formatFieldValue(value, t)}</span>
                    {onFieldUpdate && isEditableValue(value) ? (
                      <button
                        type="button"
                        aria-label={t('resultDetail.editField', { field: fieldLabel })}
                        onClick={() => startEdit(key, value)}
                        className="flex-none rounded-token px-1 text-caption text-text-muted hover:text-brand"
                      >
                        ✏️
                      </button>
                    ) : null}
                  </>
                )}
                <span
                  className={`tnum w-[58px] flex-none rounded-full py-0.5 text-center text-caption ${
                    reviewed ? 'bg-success/15 text-success' : level ? BADGE[level] : 'text-text-muted'
                  }`}
                >
                  {reviewed
                    ? t('resultDetail.reviewed')
                    : confidence === undefined
                      ? '—'
                      : formatConfidence(confidence)}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mx-4.5 mt-3.5 grid grid-cols-3 gap-px overflow-hidden rounded-card border border-border bg-border">
          {[
            { label: t('resultDetail.stats.inputTokens'), value: String(result.tokensUsed.input) },
            { label: t('resultDetail.stats.outputTokens'), value: String(result.tokensUsed.output) },
            { label: t('resultDetail.stats.cost'), value: cost },
            { label: t('resultDetail.stats.avgConfidence'), value: formatConfidence(result.avgConfidence) },
            {
              label: t('resultDetail.stats.fields'),
              value: t('resultDetail.fieldsValue', { count: entries.length, nullCount }),
            },
          ].map((stat) => (
            <div key={stat.label} className="bg-surface px-3.5 py-2.5">
              <div className="text-caption text-text-muted">{stat.label}</div>
              <div className="tnum mt-0.5 text-body font-semibold">{stat.value}</div>
            </div>
          ))}
        </div>

        <div className="mx-4.5 mt-3.5 overflow-hidden rounded-card border border-border">
          <div className="border-b border-border bg-surface-muted px-3.5 py-2 text-caption text-text-muted">
            {t('resultDetail.rawJson')}
          </div>
          <pre className="max-h-[220px] overflow-auto px-3.5 py-3 font-mono text-code">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>

        <div className="mt-3.5 flex items-center gap-2 border-t border-border px-4.5 py-3.5">
          <div className="flex-1" />
          <Button size="sm" onClick={onClose}>
            {t('resultDetail.close')}
          </Button>
          <Button size="sm" disabled>
            {t('resultDetail.retryThisItem')}
          </Button>
        </div>
      </div>
    </div>
  );
}
