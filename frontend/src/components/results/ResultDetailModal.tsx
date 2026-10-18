import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useUiStore } from '@/store/uiStore';
import type { ExtractionResult, ExtractionSource } from '@/types/extraction';
import {
  CONFIDENCE_LOW,
  fieldConfidenceLevel,
  fieldThreshold,
  formatConfidence,
  type ConfidenceLevel,
} from '@/utils/confidence';
import { formatCost } from '@/utils/currency';
import { exportToExcel } from '@/utils/excelExport';
import { buildExportFilename } from '@/utils/exportFilename';
import { problemFields, reviewState } from '@/utils/review';
import { matchesCombo } from '@/utils/shortcuts';
import { cellKey, isCellEmpty, tableReviewSummary, tablesToJson } from '@/utils/table';
import { findFieldRanges, matchFieldBoxes } from '@/utils/textHighlight';
import type { FieldBox } from '@/types/extraction';
import { SourcePreviewPane } from './SourcePreviewPane';
import { TableView } from './TableView';

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
  /** Issue #5 Ctrl+S: bring up the next document that still needs review
   * (the caller owns the results list); a no-op closes nothing. */
  onNextItem?: () => void;
  /** Table mode: reports an inline cell edit (marks the cell reviewed). */
  onCellUpdate?: (tableIndex: number, cellIndex: number, text: string) => void;
}

const EMPTY_BOXES: Record<string, FieldBox> = {};
const EMPTY_SET = new Set<string>();

/** Parses a key produced by cellKey(); null when it is not a cell key. */
function parseCellKey(key: string): [number, number] | null {
  const m = /^t(\d+)c(\d+)$/.exec(key);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export function ResultDetailModal({
  source,
  result,
  label,
  onClose,
  onFieldUpdate,
  onNextItem,
  onCellUpdate,
}: ResultDetailModalProps) {
  const isTable = source.mode === 'table';
  const tables = useMemo(() => source.tables ?? [], [source.tables]);
  const [activeTable, setActiveTable] = useState(0);
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const { t, i18n } = useTranslation();
  const shortcuts = useUiStore((s) => s.shortcuts);
  const [copied, setCopied] = useState(false);
  // Inline editing: key of the field being edited + its working value.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // Issue #5: keyboard cursor — index into `reviewOrder`, -1 before the
  // first Tab/Shift+Tab press.
  const [cursor, setCursor] = useState(-1);
  // Issue #4: locate request into the review pane; the nonce makes repeated
  // clicks on the same field re-trigger the scroll+flash.
  const [focus, setFocus] = useState<{ field: string; nonce: number } | null>(null);

  // Issue #5: the review shortcuts, dispatched from one window listener so
  // they work both in browse mode and while the edit input is focused (its
  // keydown events bubble up here). Bindable combos never include bare
  // printable keys (enforced at capture time in the settings), so typing in
  // the edit input can never trigger navigation. Re-attached on every render
  // so the handler always closes over the latest state (draft, cursor…).
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (matchesCombo(shortcuts.cancelEdit, e)) {
        e.preventDefault();
        // While editing: back to browse mode. Otherwise: close the dialog.
        if (editing !== null) setEditing(null);
        else onClose();
        return;
      }
      if (matchesCombo(shortcuts.nextField, e) || matchesCombo(shortcuts.prevField, e)) {
        const dir = matchesCombo(shortcuts.nextField, e) ? 1 : -1;
        if (goToProblemField(dir)) e.preventDefault();
        return;
      }
      if (matchesCombo(shortcuts.saveNext, e)) {
        // Always consumed — the browser's save dialog must not open.
        e.preventDefault();
        commitOpenEdit();
        onNextItem?.();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

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
    () => (isTable ? {} : findFieldRanges(source.sourceText ?? '', result.data)),
    [isTable, source.sourceText, result.data],
  );
  const reviewFieldSet = useMemo(() => {
    if (isTable) return EMPTY_SET;
    return new Set([...problems.belowThreshold.map(({ field }) => field), ...problems.empty]);
  }, [isTable, problems]);
  const reviewedFieldSet = useMemo(() => {
    if (isTable) return EMPTY_SET;
    return new Set(
      Object.entries(result.reviewedFields ?? {})
        .filter(([, reviewed]) => reviewed)
        .map(([field]) => field),
    );
  }, [isTable, result.reviewedFields]);
  // D-028: grounding boxes are matched locally against the OCR blocks that
  // arrived with the parse response — no extra model call, recomputed from
  // the persisted pagesBlocks on every open.
  const fieldBoxes = useMemo(
    () => (isTable ? EMPTY_BOXES : matchFieldBoxes(result.data, source.pagesBlocks)),
    [isTable, result.data, source.pagesBlocks],
  );
  // Table mode: every cell with a matched OCR line gets its own box; the
  // pending / edited cells color the highlight like fields do.
  const tableBoxes = useMemo(() => {
    const out: Record<string, FieldBox> = {};
    if (!isTable) return out;
    tables.forEach((table, ti) =>
      table.cells.forEach((cell, ci) => {
        if (cell.bbox) out[cellKey(ti, ci)] = cell.bbox;
      }),
    );
    return out;
  }, [isTable, tables]);
  const tablePendingSet = useMemo(() => {
    const out = new Set<string>();
    if (!isTable) return out;
    tables.forEach((table, ti) =>
      table.cells.forEach((cell, ci) => {
        if (cell.needs_review && !isCellEmpty(cell)) out.add(cellKey(ti, ci));
      }),
    );
    return out;
  }, [isTable, tables]);
  const tableEditedSet = useMemo(() => {
    const out = new Set<string>();
    if (!isTable) return out;
    tables.forEach((table, ti) =>
      table.cells.forEach((cell, ci) => {
        if (cell.edited) out.add(cellKey(ti, ci));
      }),
    );
    return out;
  }, [isTable, tables]);
  const tableSummary = useMemo(() => tableReviewSummary(tables), [tables]);
  const boxes = isTable ? tableBoxes : fieldBoxes;
  // Issue #5: keyboard navigation order — the problem fields (below their
  // threshold ∪ empty-violating) in display order. Already-reviewed fields
  // stay in the list so Shift+Tab can go back and fix a bad correction;
  // non-editable values (arrays/objects) have no inline editor and are
  // skipped. Empty while the modal is view-only.
  const reviewOrder = useMemo(() => {
    if (!onFieldUpdate || isTable) return [];
    return Object.entries(result.data ?? {})
      .filter(([key, value]) => reviewFieldSet.has(key) && isEditableValue(value))
      .map(([key]) => key);
  }, [reviewFieldSet, result.data, onFieldUpdate, isTable]);

  function startEdit(key: string, value: unknown) {
    setEditing(key);
    setDraft(value == null ? '' : String(value));
    // Issue #5: a manual ✏️ click joins the keyboard flow — the cursor
    // lands on the clicked field so Tab continues from there.
    const idx = reviewOrder.indexOf(key);
    if (idx >= 0) setCursor(idx);
  }

  /** Table mode: single click selects the cell and locates it on the image. */
  function selectCell(tableIndex: number, cellIndex: number) {
    const key = cellKey(tableIndex, cellIndex);
    setSelectedCell(key);
    if (tableBoxes[key]) setFocus({ field: key, nonce: (focus?.nonce ?? 0) + 1 });
  }

  /** Table mode: double click opens the cell editor. */
  function startCellEdit(tableIndex: number, cellIndex: number) {
    const key = cellKey(tableIndex, cellIndex);
    setSelectedCell(key);
    setEditing(key);
    setDraft(tables[tableIndex]?.cells[cellIndex]?.text ?? '');
    if (tableBoxes[key]) setFocus({ field: key, nonce: (focus?.nonce ?? 0) + 1 });
  }

  function commitCellEdit(tableIndex: number, cellIndex: number) {
    if (!onCellUpdate) return;
    const original = tables[tableIndex]?.cells[cellIndex];
    // Unchanged text still counts as reviewed: the user looked and confirmed.
    if (original) onCellUpdate(tableIndex, cellIndex, draft);
    setEditing(null);
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

  /** Commits the open edit in a value-aware way: boolean checkboxes apply
   * their change on toggle, so there is no draft to save — just leave
   * edit mode. (issue #5: shared by Tab and Ctrl+S.) */
  function commitOpenEdit() {
    if (editing === null) return;
    const cell = parseCellKey(editing);
    if (cell) {
      commitCellEdit(cell[0], cell[1]);
      return;
    }
    const raw = result.data?.[editing];
    if (typeof raw === 'boolean') {
      setEditing(null);
      return;
    }
    commitEdit(editing, raw);
  }

  /** Issue #5: move the keyboard cursor to the previous/next problem field
   * and start editing it, committing any open edit first. Returns whether
   * the key press was consumed — the caller then suppresses the browser's
   * default Tab focus navigation. Clamps at both ends. */
  function goToProblemField(dir: 1 | -1): boolean {
    if (reviewOrder.length === 0) return false;
    const wasEditing = editing !== null;
    if (wasEditing) commitOpenEdit();
    const next = cursor + dir;
    if (next < 0 || next >= reviewOrder.length) return wasEditing;
    const key = reviewOrder[next];
    setCursor(next);
    startEdit(key, result.data?.[key]);
    return true;
  }

  const exportPayload = () => (isTable ? tablesToJson(tables) : result);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(exportPayload(), null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable (e.g. insecure context); nothing to recover.
    }
  }

  function handleExport() {
    const blob = new Blob([JSON.stringify(exportPayload(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = buildExportFilename(source.presetLabel ?? source.name, 'json');
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExportExcel() {
    // Cost column currency follows the UI language (CNY under Chinese).
    void exportToExcel(
      [{ ...source, results: [result] }],
      buildExportFilename(source.presetLabel ?? source.name, 'xlsx'),
      t,
      i18n.language,
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
        className="flex max-h-[90vh] w-full max-w-[1400px] overflow-hidden rounded-card border border-border bg-surface shadow-xl"
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
        {isTable ? (
          tableSummary.pending > 0 ? (
            <div className="mx-4.5 mt-3.5 flex items-start gap-2 rounded-token border border-warning bg-warning/12 px-3 py-2.5 text-caption">
              <span>⚠️</span>
              <span>{t('table.needsReviewWarning', { count: tableSummary.pending })}</span>
            </div>
          ) : tableSummary.edited > 0 ? (
            <div className="mx-4.5 mt-3.5 flex items-start gap-2 rounded-token border border-success bg-success/12 px-3 py-2.5 text-caption">
              <span>✅</span>
              <span>{t('resultDetail.allReviewed')}</span>
            </div>
          ) : null
        ) : state === 'pending' ? (
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

        {isTable ? (
          <div className="mx-4.5 mt-3.5">
            <TableView
              tables={tables}
              activeTable={Math.min(activeTable, Math.max(tables.length - 1, 0))}
              onActiveTableChange={setActiveTable}
              selected={selectedCell}
              editing={editing}
              draft={draft}
              onDraftChange={setDraft}
              onSelect={selectCell}
              onStartEdit={onCellUpdate ? startCellEdit : undefined}
              onCommit={commitCellEdit}
            />
          </div>
        ) : null}

        {!isTable ? (
        <>
        <div className="mx-4.5 mt-3.5 overflow-hidden rounded-card border border-border">
          {entries.map(([key, value]) => {
            const confidence = result.confidence[key];
            const level =
              confidence === undefined
                ? null
                : fieldConfidenceLevel(confidence, fieldThreshold(key, source.reviewThresholds));
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
                        }
                        // Escape / Tab / Shift+Tab / Ctrl+S are handled by
                        // the window listener (issue #5 shortcuts).
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
        </>
        ) : null}

        <div className="mt-3.5 flex items-center gap-2 border-t border-border px-4.5 py-3.5">
          {/* Issue #5: discoverability for the review shortcuts, showing the
              currently configured combos. */}
          {onFieldUpdate && !isTable ? (
            <div className="min-w-0 flex-1 truncate text-caption text-text-muted">
              {t('resultDetail.shortcutHint', {
                next: shortcuts.nextField,
                prev: shortcuts.prevField,
                save: shortcuts.saveNext,
                cancel: shortcuts.cancelEdit,
              })}
            </div>
          ) : (
            <div className="flex-1" />
          )}
          <Button size="sm" onClick={onClose}>
            {t('resultDetail.close')}
          </Button>
          <Button size="sm" disabled>
            {t('resultDetail.retryThisItem')}
          </Button>
        </div>
        </div>
        <aside className="hidden w-[560px] flex-none border-l border-border lg:block">
          <SourcePreviewPane
            source={source}
            ranges={ranges}
            reviewFields={isTable ? tablePendingSet : reviewFieldSet}
            reviewedFields={isTable ? tableEditedSet : reviewedFieldSet}
            focus={focus}
            editingField={editing}
            boxes={boxes}
          />
        </aside>
      </div>
    </div>
  );
}
