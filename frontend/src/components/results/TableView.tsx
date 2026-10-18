import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { OcrTable, OcrTableCell } from '@/types/extraction';
import { fieldConfidenceLevel, formatConfidence, type ConfidenceLevel } from '@/utils/confidence';
import { cellKey, isCellEmpty } from '@/utils/table';

/** Fixed review threshold for table cells (same as CONFIDENCE_HIGH). */
const REVIEW_THRESHOLD = 0.85;

const BADGE: Record<ConfidenceLevel, string> = {
  high: 'bg-success/15 text-success',
  medium: 'bg-warning/15 text-warning',
  low: 'bg-error/15 text-error',
};

export interface TableViewProps {
  tables: OcrTable[];
  /** Index of the visible table (tab). */
  activeTable: number;
  onActiveTableChange: (index: number) => void;
  /** Currently selected cell key (see cellKey). */
  selected: string | null;
  /** Key of the cell being edited, if any. */
  editing: string | null;
  draft: string;
  onDraftChange: (value: string) => void;
  /** Single click: select + locate on the original image. */
  onSelect: (tableIndex: number, cellIndex: number) => void;
  /** Double click: review & edit. Omit to make the table read-only. */
  onStartEdit?: (tableIndex: number, cellIndex: number) => void;
  /** Enter / blur: save the draft. */
  onCommit: (tableIndex: number, cellIndex: number) => void;
}

export function TableView({
  tables,
  activeTable,
  onActiveTableChange,
  selected,
  editing,
  draft,
  onDraftChange,
  onSelect,
  onStartEdit,
  onCommit,
}: TableViewProps) {
  const { t } = useTranslation();
  // Esc cancels the edit: the window listener in the modal clears `editing`,
  // and this flag keeps the resulting blur from saving the draft.
  const cancelledRef = useRef(false);
  const table = tables[activeTable];
  if (!table) return null;

  function renderCell(cell: OcrTableCell, cellIndex: number) {
    const key = cellKey(activeTable, cellIndex);
    const empty = isCellEmpty(cell);
    const isEditing = editing === key;
    const level =
      cell.confidence === null ? null : fieldConfidenceLevel(cell.confidence, REVIEW_THRESHOLD);
    const Tag = cell.is_header ? 'th' : 'td';
    const pending = cell.needs_review && !empty;
    return (
      <Tag
        key={key}
        rowSpan={cell.rowspan > 1 ? cell.rowspan : undefined}
        colSpan={cell.colspan > 1 ? cell.colspan : undefined}
        data-testid={key}
        onClick={() => onSelect(activeTable, cellIndex)}
        onDoubleClick={() => onStartEdit?.(activeTable, cellIndex)}
        className={`min-w-[72px] cursor-pointer border border-border px-2 py-1.5 align-top text-caption ${
          cell.is_header ? 'bg-surface-muted font-semibold' : 'bg-surface'
        } ${pending ? 'bg-warning/12' : ''} ${selected === key ? 'outline outline-2 outline-brand' : ''}`}
      >
        {isEditing ? (
          <input
            value={draft}
            autoFocus
            aria-label={t('table.editCell')}
            onChange={(e) => onDraftChange(e.target.value)}
            onFocus={() => {
              cancelledRef.current = false;
            }}
            onBlur={() => {
              if (cancelledRef.current) {
                cancelledRef.current = false;
                return;
              }
              onCommit(activeTable, cellIndex);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onCommit(activeTable, cellIndex);
              } else if (e.key === 'Escape') {
                cancelledRef.current = true;
              }
            }}
            className="w-full rounded-token border border-brand bg-surface px-1.5 py-0.5 text-caption outline-none"
          />
        ) : (
          <div className="flex flex-col gap-1">
            <span className="break-words">{cell.text}</span>
            {!empty || cell.edited ? (
              <div className="flex flex-wrap items-center gap-1">
                {cell.edited ? (
                  <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-success">
                    {t('table.edited')}
                  </span>
                ) : null}
                {level ? (
                  <span className={`tnum rounded-full px-1.5 py-0.5 ${BADGE[level]}`}>
                    {formatConfidence(cell.confidence as number)}
                  </span>
                ) : (
                  <span
                    className="rounded-full px-1.5 py-0.5 text-text-muted"
                    title={t('table.noConfidenceHint')}
                  >
                    {t('table.noConfidence')}
                  </span>
                )}
              </div>
            ) : null}
          </div>
        )}
      </Tag>
    );
  }

  // Group cells by row, in document order, keeping their global index so the
  // edit/select callbacks address the right cell.
  const rows: Array<Array<{ cell: OcrTableCell; index: number }>> = Array.from(
    { length: table.rows },
    () => [],
  );
  table.cells.forEach((cell, index) => {
    if (rows[cell.row]) rows[cell.row].push({ cell, index });
  });

  return (
    <div>
      {tables.length > 1 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {tables.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onActiveTableChange(i)}
              className={`rounded-token border px-2.5 py-1 text-caption ${
                i === activeTable
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-border text-text-muted hover:text-text'
              }`}
            >
              {t('table.tab', { index: i + 1 })}
            </button>
          ))}
        </div>
      ) : null}
      <div className="overflow-auto rounded-card border border-border">
        <table className="w-full border-collapse">
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>{row.map(({ cell, index }) => renderCell(cell, index))}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {onStartEdit ? (
        <div className="mt-2 text-caption text-text-muted">{t('table.interactionHint')}</div>
      ) : null}
    </div>
  );
}
