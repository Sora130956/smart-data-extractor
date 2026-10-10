import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { locateFields } from '@/api/client';
import { Button } from '@/components/ui/Button';
import type { ExtractionResult, ExtractionSource, FieldBox } from '@/types/extraction';
import {
  CONFIDENCE_LOW,
  confidenceLevel,
  formatConfidence,
  type ConfidenceLevel,
} from '@/utils/confidence';
import { formatCost } from '@/utils/currency';
import { exportToExcel } from '@/utils/excelExport';
import { buildExportFilename } from '@/utils/exportFilename';
import { problemFields, reviewState } from '@/utils/review';
import { findFieldRanges } from '@/utils/textHighlight';
import { SourcePreviewPane } from './SourcePreviewPane';

type TFunction = ReturnType<typeof useTranslation>['t'];

/** Mirrors the backend's MAX_VALUES cap (/locate_fields rejects longer
 * lists with a 422 — trim client-side so the first open never fails). */
const MAX_LOCATE_VALUES = 20;

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
  /** Reports the vision-locate boxes for this source (D-027) so the caller
   * can cache them on the source — re-opening must not re-bill the model.
   * Absent (tests / read-only usage) disables the background locate call. */
  onLocateBoxes?: (boxes: Record<string, FieldBox>) => void;
}

export function ResultDetailModal({ source, result, label, onClose, onFieldUpdate, onLocateBoxes }: ResultDetailModalProps) {
  const { t, i18n } = useTranslation();
  const [copied, setCopied] = useState(false);
  // Inline editing: key of the field being edited + its working value.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // Issue #4: locate request into the review pane; the nonce makes repeated
  // clicks on the same field re-trigger the scroll+flash.
  const [focus, setFocus] = useState<{ field: string; nonce: number } | null>(null);
  // D-027: the vision-locate request runs in the background while the modal
  // is open; its boxes are cached on the source via onLocateBoxes.
  const [locating, setLocating] = useState(false);
  const locateStartedFor = useRef<string | null>(null);

  // D-027 auto-locate: on first open of a file-backed source, ask the vision
  // model where each extracted value sits in the original file so the pane
  // can overlay highlight boxes on the preview. Best-effort by design: any
  // failure (quota, network, weak model) is swallowed and the pane falls
  // back to the issue #4 text-highlight view.
  useEffect(() => {
    const values = Object.entries(result.data ?? {})
      .filter(([, v]) => v != null && typeof v !== 'object')
      .map(([key, v]) => ({ key, text: String(v) }))
      .slice(0, MAX_LOCATE_VALUES);
    if (
      source.fieldBoxes != null || // already located (even if nothing was found)
      onLocateBoxes == null ||
      source.sourceFileUrl == null ||
      (source.type !== 'pdf' && source.type !== 'image') ||
      values.length === 0 ||
      locateStartedFor.current === source.id
    ) {
      return;
    }
    locateStartedFor.current = source.id;
    let cancelled = false;
    setLocating(true);
    void (async () => {
      try {
        const blob = await fetch(source.sourceFileUrl as string).then((r) => r.blob());
        const type =
          blob.type || (source.type === 'pdf' ? 'application/pdf' : 'image/png');
        const file = new File([blob], source.name, { type });
        const response = await locateFields(file, values.map((v) => v.text));
        const boxes: Record<string, FieldBox> = {};
        values.forEach(({ key }, i) => {
          const box = response.boxes[i];
          if (box != null) boxes[key] = box;
        });
        if (!cancelled) onLocateBoxes(boxes);
      } catch {
        // Silent: the review pane degrades to the text-highlight view.
      } finally {
        if (!cancelled) setLocating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // The ref guard makes re-runs (new result objects from edits) harmless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.id, source.fieldBoxes, source.sourceFileUrl, source.type, result.data, onLocateBoxes]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const entries = Object.entries(result.data ?? {});
  const nullCount = entries.filter(([, v]) => v === null || v === undefined).length;
  // Issue #2 / issue #3 kernel: the two review triggers, computed once and
  // consumed by the warning banner AND the pane highlight colors (issue #4).
  const problems = useMemo(() => problemFields(result, source), [result, source]);
  const state = useMemo(() => reviewState(result, source), [result, source]);
  const reviewFields = problems.belowThreshold.map(
    ({ field, threshold }) => `${source.fieldLabels?.[field] ?? field} (${formatConfidence(threshold)})`,
  );
  const emptyFields = problems.empty.map((field) => source.fieldLabels?.[field] ?? field);
  const cost = formatCost(result.costUsd, result.costCny, i18n.resolvedLanguage ?? 'en');

  // Issue #4: where each field value came from in the source text, plus the
  // per-field review/reviewed state that colors the pane's highlights.
  const ranges = useMemo(
    () => findFieldRanges(source.sourceText ?? '', result.data),
    [source.sourceText, result.data],
  );
  const reviewFieldSet = useMemo(
    () => new Set([...problems.belowThreshold.map(({ field }) => field), ...problems.empty]),
    [problems],
  );
  const reviewedFieldSet = useMemo(
    () =>
      new Set(
        Object.entries(result.reviewedFields ?? {})
          .filter(([, reviewed]) => reviewed)
          .map(([field]) => field),
      ),
    [result.reviewedFields],
  );
  // D-027: vision-locate boxes cached on the source (Record may be empty —
  // located but nothing found; undefined = not located yet).
  const boxes = source.fieldBoxes ?? {};

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
        className="flex max-h-[90vh] w-full max-w-[1080px] overflow-hidden rounded-card border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Issue #4: two columns — fields on the left, the original file /
            extraction text on the right for in-place review. The pane hides
            on narrow screens (the header's export actions still work). */}
        <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="flex items-center gap-2 border-b border-border px-4.5 py-3.5">
          <div>
            <div className="text-title font-semibold">{t('resultDetail.title', { index: label })}</div>
            <div className="text-caption text-text-muted">
              {source.name}
              {source.meta ? ` · ${source.meta}` : ''}
            </div>
          </div>
          <div className="flex-1" />
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

        {/* Issue #3: the banner follows the shared three-state review status.
            pending → per-field attribution, or the aggregate-average warning
            when no single field is to blame; reviewed → success banner so a
            fully reviewed item never claims to still need review. */}
        {state === 'pending' ? (
          <div className="mx-4.5 mt-3.5 flex items-start gap-2 rounded-token border border-warning bg-warning/12 px-3 py-2.5 text-caption">
            <span>⚠️</span>
            <div className="flex flex-col gap-0.5">
              {reviewFields.length > 0 ? (
                <span>
                  {t('resultDetail.needsReviewWarning', {
                    count: reviewFields.length,
                    fields: reviewFields.join(', '),
                  })}
                </span>
              ) : null}
              {emptyFields.length > 0 ? (
                <span>
                  {t('resultDetail.needsReviewEmptyWarning', {
                    count: emptyFields.length,
                    fields: emptyFields.join(', '),
                  })}
                </span>
              ) : null}
              {reviewFields.length === 0 && emptyFields.length === 0 ? (
                <span>
                  {t('resultDetail.needsReviewAvgWarning', {
                    threshold: formatConfidence(CONFIDENCE_LOW),
                  })}
                </span>
              ) : null}
            </div>
          </div>
        ) : state === 'reviewed' ? (
          <div className="mx-4.5 mt-3.5 flex items-start gap-2 rounded-token border border-success bg-success/12 px-3 py-2.5 text-caption">
            <span>✅</span>
            <span>{t('resultDetail.allReviewed')}</span>
          </div>
        ) : null}

        <div className="mx-4.5 mt-3.5 overflow-hidden rounded-card border border-border">
          {entries.map(([key, value]) => {
            const confidence = result.confidence[key];
            const level = confidence === undefined ? null : confidenceLevel(confidence);
            const fieldLabel = source.fieldLabels?.[key] ?? key;
            const reviewed = result.reviewedFields?.[key] === true;
            // Issue #1: reviewed fields keep showing what the LLM originally
            // extracted, next to the human-corrected value.
            const hasSnapshot =
              reviewed &&
              result.originalData != null &&
              Object.prototype.hasOwnProperty.call(result.originalData, key);
            return (
              <div
                key={key}
                className="flex items-start gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0"
              >
                <span className="w-[140px] flex-none self-center text-center text-caption text-text-muted">
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
                    <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5">
                      <span className="break-words text-caption">{formatFieldValue(value, t)}</span>
                      {hasSnapshot ? (
                        <span className="flex flex-wrap items-baseline gap-1.5 text-caption text-text-muted">
                          <span className="flex-none">{t('resultDetail.originalValue')}</span>
                          {formatFieldValue(result.originalData?.[key], t)}
                        </span>
                      ) : null}
                    </div>
                    {ranges[key] || boxes[key] ? (
                      <button
                        type="button"
                        aria-label={t('resultDetail.locateField', { field: fieldLabel })}
                        onClick={() =>
                          setFocus({ field: key, nonce: (focus?.nonce ?? 0) + 1 })
                        }
                        className="flex-none rounded-token px-1 text-caption text-text-muted hover:text-brand"
                      >
                        🔍
                      </button>
                    ) : null}
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
        <aside className="hidden w-[400px] flex-none border-l border-border lg:block">
          <SourcePreviewPane
            source={source}
            ranges={ranges}
            reviewFields={reviewFieldSet}
            reviewedFields={reviewedFieldSet}
            focus={focus}
            boxes={boxes}
            locating={locating}
          />
        </aside>
      </div>
    </div>
  );
}
