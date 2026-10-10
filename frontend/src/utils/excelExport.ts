// Excel export (DESIGN.md §9 F6.2). buildExportModel is a pure data model
// (unit-testable, no DOM); the ExcelJS workbook build is dynamically imported
// so the library stays out of the main bundle until the user clicks Export.
import type { useTranslation } from 'react-i18next';
import type { Workbook } from 'exceljs';
import type { ExtractionSource } from '@/types/extraction';

type TFunction = ReturnType<typeof useTranslation>['t'];

export type CellValue = string | number | boolean | null;

export interface ExportSheet {
  name: string;
  columns: string[];
  rows: CellValue[][];
}

export interface ExportModel {
  results: ExportSheet;
  confidence: ExportSheet;
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

export function buildExportModel(sources: ExtractionSource[], t: TFunction): ExportModel {
  const keys = fieldKeys(sources);
  const fields = columnHeaders(sources, keys);

  // Issue #1: a field reviewed on any row gets a companion "(Original)"
  // column right after it, so the sheet compares the LLM's extraction with
  // the human correction. Fields never reviewed keep the old layout.
  const reviewedKeys = new Set<string>();
  for (const source of sources) {
    for (const result of source.results) {
      for (const key of keys) {
        if (result.reviewedFields?.[key]) reviewedKeys.add(key);
      }
    }
  }
  const fieldColumns = fields.flatMap((header, i) =>
    reviewedKeys.has(keys[i]) ? [header, t('excel.originalColumn', { field: header })] : [header],
  );

  const resultsRows: CellValue[][] = [];
  const confidenceRows: CellValue[][] = [];
  for (const source of sources) {
    for (const result of source.results) {
      const fieldCells = keys.flatMap((key): CellValue[] => {
        const cells: CellValue[] = [toCell(result.data?.[key])];
        if (reviewedKeys.has(key)) {
          cells.push(
            result.reviewedFields?.[key]
              ? toCell(result.originalData?.[key] ?? null)
              : null,
          );
        }
        return cells;
      });
      resultsRows.push([
        source.name,
        result.index,
        result.status === 'success' ? t('excel.statusSuccess') : t('excel.statusFailed'),
        result.error ?? null,
        ...fieldCells,
        result.avgConfidence,
        result.costUsd,
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
        ...fieldColumns,
        t('excel.avgConfidence'),
        t('excel.costUsd'),
      ],
      rows: resultsRows,
    },
    confidence: {
      name: t('excel.sheetConfidence'),
      columns: [t('excel.source'), t('excel.item'), ...fields, t('excel.avgConfidence')],
      rows: confidenceRows,
    },
  };
}

export async function buildWorkbook(model: ExportModel): Promise<Workbook> {
  const { Workbook } = await import('exceljs');
  const workbook = new Workbook();
  for (const sheet of [model.results, model.confidence]) {
    const ws = workbook.addWorksheet(sheet.name);
    ws.addRow(sheet.columns).font = { bold: true };
    for (const row of sheet.rows) ws.addRow(row);
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.columns.forEach((column, i) => {
      column.width = i < 2 ? 22 : 16;
    });
  }
  return workbook;
}

export async function exportToExcel(
  sources: ExtractionSource[],
  filename: string,
  t: TFunction,
): Promise<void> {
  const workbook = await buildWorkbook(buildExportModel(sources, t));
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
