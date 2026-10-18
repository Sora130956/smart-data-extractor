import { describe, expect, it } from 'vitest';
import type { OcrTable, OcrTableCell } from '@/types/extraction';
import {
  applyCellEdit,
  buildTableSource,
  cellKey,
  pickPageTables,
  tableReviewSummary,
  tablesToMatrix,
  tablesToJson,
} from './table';

function cell(partial: Partial<OcrTableCell> & Pick<OcrTableCell, 'row' | 'col' | 'text'>): OcrTableCell {
  return {
    rowspan: 1,
    colspan: 1,
    is_header: false,
    confidence: 0.95,
    bbox: { page: 0, box: [1, 2, 3, 4] },
    needs_review: false,
    edited: false,
    ...partial,
  };
}

function sampleTable(): OcrTable {
  return {
    page: 0,
    bbox: [0, 0, 100, 100],
    rows: 3,
    cols: 2,
    cells: [
      cell({ row: 0, col: 0, colspan: 2, text: 'Title', is_header: true }),
      cell({ row: 1, col: 0, text: 'A', confidence: 0.6, needs_review: true }),
      cell({ row: 1, col: 1, text: 'B', confidence: null, bbox: null, needs_review: true }),
      cell({ row: 2, col: 0, text: '', confidence: null, bbox: null }),
      cell({ row: 2, col: 1, text: 'D', confidence: 0.9 }),
    ],
  };
}

describe('cellKey', () => {
  it('encodes table and cell index', () => {
    expect(cellKey(1, 4)).toBe('t1c4');
  });
});

describe('tableReviewSummary', () => {
  it('counts non-empty cells, pending and edited', () => {
    const tables = [sampleTable()];
    tables[0].cells[4] = { ...tables[0].cells[4], edited: true };
    expect(tableReviewSummary(tables)).toEqual({ tables: 1, cells: 4, pending: 2, edited: 1 });
  });

  it('ignores needs_review on empty cells', () => {
    const t = sampleTable();
    t.cells[3] = { ...t.cells[3], needs_review: true };
    expect(tableReviewSummary([t]).pending).toBe(2);
  });
});

describe('applyCellEdit', () => {
  it('marks edited, clears needs_review and keeps confidence; pure', () => {
    const tables = [sampleTable()];
    const next = applyCellEdit(tables, 0, 1, 'A2');
    expect(next[0].cells[1]).toMatchObject({ text: 'A2', edited: true, needs_review: false, confidence: 0.6 });
    expect(tables[0].cells[1].text).toBe('A');
    expect(next[0].cells[0]).toBe(tables[0].cells[0]);
  });
});

describe('tablesToMatrix', () => {
  it('puts text on top-left of merged cells and blanks the rest', () => {
    expect(tablesToMatrix(sampleTable())).toEqual([
      ['Title', ''],
      ['A', 'B'],
      ['', 'D'],
    ]);
  });
});

describe('tablesToJson', () => {
  it('exports matrix and cell metadata per table', () => {
    const json = tablesToJson([sampleTable()]);
    expect(json).toHaveLength(1);
    expect(json[0].rows).toEqual([
      ['Title', ''],
      ['A', 'B'],
      ['', 'D'],
    ]);
    expect(json[0].cells[1]).toMatchObject({ row: 1, col: 0, text: 'A', confidence: 0.6, needs_review: true });
  });
});

describe('pickPageTables', () => {
  it('keeps one page and re-indexes it to page 0', () => {
    const t0 = sampleTable();
    const t1: OcrTable = {
      ...sampleTable(),
      page: 1,
      cells: sampleTable().cells.map((c) => ({ ...c, bbox: c.bbox ? { page: 1, box: c.bbox.box } : null })),
    };
    const picked = pickPageTables([t0, t1], 1);
    expect(picked).toHaveLength(1);
    expect(picked[0].page).toBe(0);
    expect(picked[0].cells[0].bbox?.page).toBe(0);
  });
});

describe('buildTableSource', () => {
  it('builds a table-mode source with one successful result', () => {
    const source = buildTableSource(
      { name: 'a.png', text: 'raw', fileUrl: 'blob:x', fileType: 'image', tables: [sampleTable()] },
      'batch1',
      0,
    );
    expect(source.mode).toBe('table');
    expect(source.type).toBe('image');
    expect(source.name).toBe('a.png');
    expect(source.sourceFileUrl).toBe('blob:x');
    expect(source.results).toHaveLength(1);
    expect(source.results[0].status).toBe('success');
    expect(source.stats.succeeded).toBe(1);
    // mean of 0.95? -> non-empty cells with confidence: 0.95, 0.6, 0.9
    expect(source.results[0].avgConfidence).toBeCloseTo((0.95 + 0.6 + 0.9) / 3);
  });
});
