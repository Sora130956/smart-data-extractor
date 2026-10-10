import { describe, expect, it } from 'vitest';
import i18next from 'i18next';
import '@/i18n';
import type { useTranslation } from 'react-i18next';
import { buildExportModel, buildWorkbook } from './excelExport';
import type { ExtractionResult, ExtractionSource } from '@/types/extraction';

type TFunction = ReturnType<typeof useTranslation>['t'];
const t: TFunction = i18next.t.bind(i18next) as TFunction;

function makeResult(overrides: Partial<ExtractionResult>): ExtractionResult {
  return {
    sourceId: 'text-0',
    index: '1',
    status: 'success',
    data: {},
    confidence: {},
    avgConfidence: 0.9,
    tokensUsed: { input: 100, output: 20 },
    costUsd: 0.0002,
    costCny: 0.00145,
    ...overrides,
  };
}

function makeSource(
  overrides: Partial<ExtractionSource> & { results: ExtractionResult[] },
): ExtractionSource {
  return {
    id: 'text-0',
    type: 'text',
    name: 'Manual Input 1',
    uploadedAt: '2024-03-14T00:00:00.000Z',
    stats: {
      succeeded: 1,
      failed: 0,
      totalCostUsd: 0.0002,
      totalCostCny: 0.00145,
      avgConfidence: 0.9,
      schemaResolveCostUsd: 0,
      schemaResolveCostCny: 0,
    },
    ...overrides,
  };
}

const labeledSource = makeSource({
  id: 'text-1',
  name: 'Invoice A',
  fieldLabels: { vendor: 'Vendor', total: 'Total' },
  results: [
    makeResult({
      sourceId: 'text-1',
      data: { vendor: 'Acme Corp', total: 1200, tags: ['urgent', 'paid'], meta: { page: 1 }, note: null, active: true },
      confidence: { vendor: 0.9, total: 0.88, tags: 0.7, note: 0.5 },
      avgConfidence: 0.92,
    }),
    makeResult({
      sourceId: 'text-1',
      index: '2',
      status: 'failed',
      data: null,
      confidence: {},
      avgConfidence: 0,
      error: 'OCR failed',
    }),
  ],
});

const bareSource = makeSource({
  id: 'text-2',
  name: 'Lead B',
  results: [
    makeResult({ sourceId: 'text-2', data: { email: 'x@y.z' }, confidence: { email: 0.95 } }),
  ],
});

// Issue #1: a reviewed field must keep its original extraction value so the
// export can compare the LLM's answer with the human correction.
const reviewedSource = makeSource({
  id: 'text-3',
  name: 'Invoice C',
  fieldLabels: { vendor: 'Vendor', total: 'Total' },
  results: [
    makeResult({
      sourceId: 'text-3',
      data: { vendor: 'Beta Ltd', total: 1200 },
      confidence: { vendor: 0.9, total: 0.88 },
      originalData: { vendor: 'Acme Corp' },
      reviewedFields: { vendor: true },
    }),
    makeResult({
      sourceId: 'text-3',
      index: '2',
      data: { vendor: 'Unreviewed Ltd', total: 300 },
      confidence: { vendor: 0.9, total: 0.5 },
    }),
  ],
});

describe('buildExportModel', () => {
  const model = buildExportModel([labeledSource, bareSource], t);

  it('names the two sheets via i18n', () => {
    expect(model.results.name).toBe('Results');
    expect(model.confidence.name).toBe('Field Confidence');
  });

  it('lays out the results sheet columns: fixed meta, field union (labeled, first-seen order), then aggregates', () => {
    expect(model.results.columns).toEqual([
      'Source',
      'Item',
      'Status',
      'Error',
      'Vendor',
      'Total',
      'tags',
      'meta',
      'note',
      'active',
      'email',
      'Avg Confidence',
      'Cost (USD)',
    ]);
  });

  it('serializes cells: numbers/booleans kept native, null empty, arrays joined, objects stringified', () => {
    expect(model.results.rows[0]).toEqual([
      'Invoice A',
      '1',
      'Success',
      null,
      'Acme Corp',
      1200,
      'urgent, paid',
      '{"page":1}',
      null,
      true,
      null,
      0.92,
      0.0002,
    ]);
  });

  it('emits failed rows with the error text and empty field cells', () => {
    expect(model.results.rows[1]).toEqual([
      'Invoice A',
      '2',
      'Failed',
      'OCR failed',
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      0,
      0.0002,
    ]);
  });

  it('lays out the confidence sheet: meta, field confidences as numbers (missing -> null), avg', () => {
    expect(model.confidence.columns).toEqual([
      'Source',
      'Item',
      'Vendor',
      'Total',
      'tags',
      'meta',
      'note',
      'active',
      'email',
      'Avg Confidence',
    ]);
    expect(model.confidence.rows[0]).toEqual([
      'Invoice A',
      '1',
      0.9,
      0.88,
      0.7,
      null,
      0.5,
      null,
      null,
      0.92,
    ]);
    expect(model.confidence.rows[2]).toEqual(['Lead B', '1', null, null, null, null, null, null, 0.95, 0.9]);
  });

  it('keeps one row per result across sources, in accumulation order', () => {
    expect(model.results.rows).toHaveLength(3);
    expect(model.results.rows[2][0]).toBe('Lead B');
    expect(model.confidence.rows).toHaveLength(3);
  });

  it('adds no original-value columns when no field was reviewed', () => {
    expect(model.results.columns.some((c) => c.includes('(Original)'))).toBe(false);
  });
});

describe('buildExportModel with reviewed fields (issue #1)', () => {
  const model = buildExportModel([reviewedSource, bareSource], t);

  it('inserts an "(Original)" column right after each reviewed field column', () => {
    const columns = model.results.columns;
    expect(columns).toEqual([
      'Source',
      'Item',
      'Status',
      'Error',
      'Vendor',
      'Vendor (Original)', // reviewed union-wide -> companion column
      'Total', // never reviewed anywhere -> no companion
      'email',
      'Avg Confidence',
      'Cost (USD)',
    ]);
  });

  it('fills the original column only on reviewed rows; unreviewed rows stay empty', () => {
    // Row 1 (Invoice C / item 1): vendor reviewed -> original 'Acme Corp'.
    expect(model.results.rows[0][5]).toBe('Acme Corp');
    expect(model.results.rows[0][4]).toBe('Beta Ltd');
    // Row 2 (Invoice C / item 2): vendor not reviewed on this row -> empty.
    expect(model.results.rows[1][5]).toBeNull();
    // Row 3 (Lead B): empty as well.
    expect(model.results.rows[2][5]).toBeNull();
  });

  it('leaves the confidence sheet layout untouched by review state', () => {
    expect(model.confidence.columns).toEqual([
      'Source',
      'Item',
      'Vendor',
      'Total',
      'email',
      'Avg Confidence',
    ]);
  });
});

describe('buildWorkbook', () => {
  // exceljs buffer writes occasionally exceed the 5s default when the whole
  // suite runs in parallel (known flake, D-019) — give it headroom.
  it('builds the two sheets with a bold frozen header row, and writes a valid buffer', { timeout: 20000 }, async () => {
    const model = buildExportModel([labeledSource, bareSource], t);
    const workbook = await buildWorkbook(model);

    expect(workbook.worksheets.map((ws) => ws.name)).toEqual(['Results', 'Field Confidence']);

    const results = workbook.getWorksheet('Results')!;
    expect(results.rowCount).toBe(4); // header + 3 results
    expect(results.getRow(1).getCell(5).value).toBe('Vendor');
    expect(results.getRow(1).font?.bold).toBe(true);
    expect(results.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(results.getRow(2).getCell(6).value).toBe(1200);

    const buffer = await workbook.xlsx.writeBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
  });
});
