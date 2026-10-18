// Table mode helpers: pure functions over the recognized tables (GLM-OCR HTML
// tables with per-cell OCR confidence). Cells are edited in place and never
// re-sent to the backend.

import type {
  ExtractionResult,
  ExtractionSource,
  OcrBlock,
  OcrTable,
  OcrTableCell,
} from '@/types/extraction';

/** Unique key of a cell inside one source, used for box overlays / focus. */
export function cellKey(tableIndex: number, cellIndex: number): string {
  return `t${tableIndex}c${cellIndex}`;
}

export function isCellEmpty(cell: Pick<OcrTableCell, 'text'>): boolean {
  return cell.text.trim() === '';
}

export interface TableReviewSummary {
  tables: number;
  /** Non-empty cells. */
  cells: number;
  /** Non-empty cells still flagged for review. */
  pending: number;
  /** Cells the user edited. */
  edited: number;
}

export function tableReviewSummary(tables: OcrTable[] | undefined): TableReviewSummary {
  const summary: TableReviewSummary = { tables: tables?.length ?? 0, cells: 0, pending: 0, edited: 0 };
  for (const table of tables ?? []) {
    for (const cell of table.cells) {
      if (cell.edited) summary.edited += 1;
      if (isCellEmpty(cell)) continue;
      summary.cells += 1;
      if (cell.needs_review) summary.pending += 1;
    }
  }
  return summary;
}

/** Returns new tables with one cell's text corrected: marked edited, review
 * flag cleared, original confidence kept. Pure — no mutation. */
export function applyCellEdit(
  tables: OcrTable[],
  tableIndex: number,
  cellIndex: number,
  text: string,
): OcrTable[] {
  return tables.map((table, ti) =>
    ti !== tableIndex
      ? table
      : {
          ...table,
          cells: table.cells.map((cell, ci) =>
            ci !== cellIndex ? cell : { ...cell, text, edited: true, needs_review: false },
          ),
        },
  );
}

/** rows × cols text matrix. A merged cell's text sits at its top-left slot,
 * the covered slots stay empty (same as a merged range in Excel). */
export function tablesToMatrix(table: OcrTable): string[][] {
  const matrix = Array.from({ length: table.rows }, () => Array<string>(table.cols).fill(''));
  for (const cell of table.cells) {
    if (matrix[cell.row] && cell.col < table.cols) matrix[cell.row][cell.col] = cell.text;
  }
  return matrix;
}

export interface TableJson {
  page: number;
  rows: string[][];
  cells: Array<{
    row: number;
    col: number;
    rowspan: number;
    colspan: number;
    text: string;
    is_header: boolean;
    confidence: number | null;
    needs_review: boolean;
    edited: boolean;
  }>;
}

/** JSON export: rows × cols text array plus per-cell metadata. */
export function tablesToJson(tables: OcrTable[]): TableJson[] {
  return tables.map((table) => ({
    page: table.page,
    rows: tablesToMatrix(table),
    cells: table.cells.map((c) => ({
      row: c.row,
      col: c.col,
      rowspan: c.rowspan,
      colspan: c.colspan,
      text: c.text,
      is_header: c.is_header,
      confidence: c.confidence,
      needs_review: c.needs_review,
      edited: c.edited,
    })),
  }));
}

/** Keep only one page's tables and re-index them to page 0 (PDF "pages"
 * split mode: each page becomes its own source with a single page image). */
export function pickPageTables(tables: OcrTable[], page: number): OcrTable[] {
  return tables
    .filter((t) => t.page === page)
    .map((t) => ({
      ...t,
      page: 0,
      cells: t.cells.map((c) => ({ ...c, bbox: c.bbox ? { ...c.bbox, page: 0 } : null })),
    }));
}

/** Mean confidence over non-empty cells that carry a signal. */
function averageCellConfidence(tables: OcrTable[]): number {
  const values: number[] = [];
  for (const table of tables) {
    for (const cell of table.cells) {
      if (!isCellEmpty(cell) && cell.confidence !== null) values.push(cell.confidence);
    }
  }
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

export interface TableStagedInput {
  name: string;
  text: string;
  fileUrl?: string;
  fileType?: 'pdf' | 'image';
  pageImages?: string[];
  pagesBlocks?: Array<OcrBlock[] | null>;
  tables?: OcrTable[];
}

/** Build a table-mode source: no /batch_extract call, no LLM cost. One
 * successful result stands in for the whole document so lists, filters and
 * the detail modal keep working unchanged. */
export function buildTableSource(
  item: TableStagedInput,
  batchId: string,
  index: number,
): ExtractionSource {
  const tables = item.tables ?? [];
  const sourceId = `table-${batchId}-${index}`;
  const avgConfidence = averageCellConfidence(tables);
  const result: ExtractionResult = {
    sourceId,
    index: '1',
    status: 'success',
    data: {},
    confidence: {},
    avgConfidence,
    tokensUsed: { input: 0, output: 0 },
    costUsd: 0,
    costCny: 0,
  };
  const preview = item.text.trim().replace(/\s+/g, ' ').slice(0, 60);
  return {
    id: sourceId,
    type: item.fileType ?? 'text',
    name: item.name,
    uploadedAt: new Date().toISOString(),
    meta: preview,
    mode: 'table',
    tables,
    ...(item.fileUrl ? { sourceFileUrl: item.fileUrl } : {}),
    ...(item.text ? { sourceText: item.text } : {}),
    ...((item.pageImages?.length ?? 0) > 0 ? { pageImages: item.pageImages } : {}),
    ...((item.pagesBlocks?.length ?? 0) > 0 ? { pagesBlocks: item.pagesBlocks } : {}),
    results: [result],
    stats: {
      succeeded: 1,
      failed: 0,
      totalCostUsd: 0,
      totalCostCny: 0,
      avgConfidence,
      schemaResolveCostUsd: 0,
      schemaResolveCostCny: 0,
    },
  };
}
