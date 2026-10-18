// Excel export (DESIGN.md §9 F6.2). buildExportModel is a pure data model
// (unit-testable, no DOM); the ExcelJS workbook build is dynamically imported
// so the library stays out of the main bundle until the user clicks Export.
import type { useTranslation } from 'react-i18next';
import type { Workbook } from 'exceljs';
import type { ExtractionSource } from '@/types/extraction';
import { tablesToMatrix } from '@/utils/table';

type TFunction = ReturnType<typeof useTranslation>['t'];

export type CellValue = string | number | boolean | null;

export interface ExportSheet {
  name: string;
  columns: string[];
  rows: CellValue[][];
}

/** A recognized table, laid out on its own worksheet. `merges` are 1-based
 * [top, left, bottom, right] ranges for cells spanning several rows/cols. */
export interface TableSheet {
  name: string;
  rows: string[][];
  merges: Array<[number, number, number, number]>;
}

export interface ExportModel {
  results: ExportSheet;
  confidence: ExportSheet;
  /** Table-mode sources: one sheet per table, in source order. */
  tables: TableSheet[];
}

function buildTableSheets(sources: ExtractionSource[], t: TFunction): TableSheet[] {
  const sheets: TableSheet[] = [];
  for (const source of sources) {
    if (source.mode !== 'table') continue;
    for (const table of source.tables ?? []) {
      const merges: TableSheet['merges'] = [];
      for (const cell of table.cells) {
        if (cell.rowspan > 1 || cell.colspan > 1) {
          merges.push([
            cell.row + 1,
            cell.col + 1,
            cell.row + cell.rowspan,
            cell.col + cell.colspan,
          ]);
        }
      }
      sheets.push({
        name: t('excel.sheetTable', { index: sheets.length + 1 }),
        rows: tablesToMatrix(table),
        merges,
      });
    }
  }
  return sheets;
}

/** Mirrors ResultDetailModal's formatFieldValue, but keeps primitives native
 * (numbers stay numbers so Excel can compute on them) and maps null to an
 * empty cell instead of a "null" string. */
function toCell(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    const hasObjects = value.some((v) => v !== null && typeof v === 'object');
    return hasObjects ? JSON.stringify(value) : value.map((v) => String(v)).join(', ');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

/** Union of field keys across every result, first-seen order (data keys first,
 * then any confidence-only keys). */
function fieldKeys(sources: ExtractionSource[]): string[] {
  const seen = new Set<string>();
  for (const source of sources) {
    for (const result of source.results) {
      for (const key of [...Object.keys(result.data ?? {}), ...Object.keys(result.confidence)]) {
        seen.add(key);
      }
    }
  }
  return [...seen];
}

/** Column header: the first snapshot label any source gave the field, else the raw key. */
function columnHeaders(sources: ExtractionSource[], keys: string[]): string[] {
  const labelFor = new Map<string, string>();
  for (const source of sources) {
    for (const [key, label] of Object.entries(source.fieldLabels ?? {})) {
      if (!labelFor.has(key)) labelFor.set(key, label);
    }
  }
  return keys.map((key) => labelFor.get(key) ?? key);
}

/** Cost column currency follows the UI language: Chinese exports CNY
 * (result.costCny), everything else exports USD (result.costUsd). Both
 * values are converted server-side at extraction time. */
function useCny(language: string): boolean {
  return language.toLowerCase().startsWith('zh');
}

export function buildExportModel(
  allSources: ExtractionSource[],
  t: TFunction,
  language: string,
): ExportModel {
  const tableSheets = buildTableSheets(allSources, t);
  // Table-mode sources have no field data; they export as table sheets only.
  const sources = allSources.filter((s) => s.mode !== 'table');
  const keys = fieldKeys(sources);
  const fields = columnHeaders(sources, keys);
  const cny = useCny(language);
  const costHeader = cny ? t('excel.costCny') : t('excel.costUsd');

  // The sheet reflects the reviewed/corrected `data` only — one column per
  // field, no "(Original)" companions. Original extraction values stay in
  // the UI detail modal / history store (Issue #1 rework).
  const resultsRows: CellValue[][] = [];
  const confidenceRows: CellValue[][] = [];
  for (const source of sources) {
    for (const result of source.results) {
      resultsRows.push([
        source.name,
        result.index,
        result.status === 'success' ? t('excel.statusSuccess') : t('excel.statusFailed'),
        result.error ?? null,
        ...keys.map((key) => toCell(result.data?.[key])),
        result.avgConfidence,
        cny ? result.costCny : result.costUsd,
      ]);
      confidenceRows.push([
        source.name,
        result.index,
        ...keys.map((key) => result.confidence[key] ?? null),
        result.avgConfidence,
      ]);
    }
  }

  return {
    results: {
      name: t('excel.sheetResults'),
      columns: [
        t('excel.source'),
        t('excel.item'),
        t('excel.status'),
        t('excel.error'),
        ...fields,
        t('excel.avgConfidence'),
        costHeader,
      ],
      rows: resultsRows,
    },
    confidence: {
      name: t('excel.sheetConfidence'),
      columns: [t('excel.source'), t('excel.item'), ...fields, t('excel.avgConfidence')],
      rows: confidenceRows,
    },
    tables: tableSheets,
  };
}

/** ExcelJS width unit ≈ one default-font character; CJK/fullwidth glyphs
 * occupy roughly two. Used to auto-fit columns to their content (issue #12). */
const WIDE_CHAR = /[\u2E80-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF\uFF00-\uFF60\uFFE0-\uFFE6]/u;

function textWidth(value: CellValue): number {
  if (value === null) return 0;
  let width = 0;
  for (const ch of String(value)) {
    width += WIDE_CHAR.test(ch) ? 2 : 1;
  }
  return width;
}

const WIDTH_PADDING = 2; // cell inner margins + bold header slack
const MIN_COLUMN_WIDTH = 6; // keep short columns readable
const MAX_COLUMN_WIDTH = 60; // cap runaway content (long errors, stringified JSON)

/** Issue #12: per-column width = widest of header/cells + padding, clamped to
 * [MIN, MAX]. Pure so it stays unit-testable without ExcelJS. */
export function autoColumnWidths(sheet: ExportSheet): number[] {
  const widths = sheet.columns.map((header) => textWidth(header) + WIDTH_PADDING);
  for (const row of sheet.rows) {
    row.forEach((cell, i) => {
      if (i < widths.length) {
        widths[i] = Math.max(widths[i], textWidth(cell) + WIDTH_PADDING);
      }
    });
  }
  return widths.map((w) => Math.min(Math.max(w, MIN_COLUMN_WIDTH), MAX_COLUMN_WIDTH));
}

export async function buildWorkbook(model: ExportModel): Promise<Workbook> {
  const { Workbook } = await import('exceljs');
  const workbook = new Workbook();
  // Pure table exports skip the (empty) field sheets.
  const fieldSheets =
    model.results.rows.length === 0 && model.tables.length > 0
      ? []
      : [model.results, model.confidence];
  for (const table of model.tables) {
    const ws = workbook.addWorksheet(table.name);
    for (const row of table.rows) ws.addRow(row);
    for (const [top, left, bottom, right] of table.merges) ws.mergeCells(top, left, bottom, right);
    ws.columns.forEach((column) => {
      column.width = 18;
    });
  }
  for (const sheet of fieldSheets) {
    const ws = workbook.addWorksheet(sheet.name);
    ws.addRow(sheet.columns).font = { bold: true };
    for (const row of sheet.rows) ws.addRow(row);
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    const widths = autoColumnWidths(sheet);
    ws.columns.forEach((column, i) => {
      column.width = widths[i] ?? MIN_COLUMN_WIDTH;
    });
  }
  return workbook;
}

export async function exportToExcel(
  sources: ExtractionSource[],
  filename: string,
  t: TFunction,
  language: string,
): Promise<void> {
  const workbook = await buildWorkbook(buildExportModel(sources, t, language));
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
