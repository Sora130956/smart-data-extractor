import { describe, expect, it } from 'vitest';
import { findFieldRanges, findFieldRange } from './textHighlight';

// OCR text: values may differ in case or be split across lines/whitespace.
const INVOICE_TEXT = `INVOICE
Invoice No: INV-2024-001
Vendor: Acme   Corp
Total Amount: $1,234.50
Paid: yes`;

describe('findFieldRange', () => {
  it('finds an exact value and returns offsets into the ORIGINAL text', () => {
    const range = findFieldRange(INVOICE_TEXT, 'INV-2024-001');
    expect(range).not.toBeNull();
    const [start, end] = range as [number, number];
    expect(INVOICE_TEXT.slice(start, end)).toBe('INV-2024-001');
  });

  it('matches case-insensitively and across whitespace runs', () => {
    // "Acme   Corp" (three spaces) matches "acme corp"; the slice must cover
    // the original multi-space span.
    const range = findFieldRange(INVOICE_TEXT, 'acme corp');
    expect(range).not.toBeNull();
    const [start, end] = range as [number, number];
    expect(INVOICE_TEXT.slice(start, end).replace(/\s+/g, ' ')).toBe('Acme Corp');
  });

  it('matches a number value inside formatted text (thousands separator)', () => {
    const range = findFieldRange(INVOICE_TEXT, 1234.5);
    expect(range).not.toBeNull();
    const [start, end] = range as [number, number];
    // The matched span covers the printed form, comma included.
    expect(INVOICE_TEXT.slice(start, end)).toBe('1,234.5');
  });

  it('returns the FIRST occurrence', () => {
    const text = 'Ref: A-1 ... duplicate A-1 at the bottom';
    const [start] = findFieldRange(text, 'A-1') as [number, number];
    expect(text.slice(start, start + 3)).toBe('A-1');
    expect(start).toBe(5);
  });

  it('returns null when the value is not present', () => {
    expect(findFieldRange(INVOICE_TEXT, 'Nonexistent Ltd')).toBeNull();
  });

  it('skips nullish, boolean, array, object and too-short values', () => {
    expect(findFieldRange(INVOICE_TEXT, null)).toBeNull();
    expect(findFieldRange(INVOICE_TEXT, undefined)).toBeNull();
    expect(findFieldRange(INVOICE_TEXT, true)).toBeNull();
    expect(findFieldRange(INVOICE_TEXT, [{ qty: 2 }])).toBeNull();
    expect(findFieldRange(INVOICE_TEXT, { a: 1 })).toBeNull();
    // Single characters match everywhere — never a useful location.
    expect(findFieldRange(INVOICE_TEXT, 'a')).toBeNull();
    expect(findFieldRange(INVOICE_TEXT, 1)).toBeNull();
  });
});

describe('findFieldRanges', () => {
  it('maps every matched scalar field to its range, keyed by field name', () => {
    const ranges = findFieldRanges(INVOICE_TEXT, {
      invoice_number: 'INV-2024-001',
      vendor: 'Acme Corp',
      total: 1234.5,
      notes: null, // empty: no range
      paid: true, // boolean: no range
      line_items: [{ name: 'Widget' }], // array: no range
    });

    expect(Object.keys(ranges).sort()).toEqual(['invoice_number', 'total', 'vendor']);
    expect(INVOICE_TEXT.slice(...(ranges.invoice_number as [number, number]))).toBe(
      'INV-2024-001',
    );
  });

  it('drops a later field whose range overlaps an earlier one', () => {
    const text = 'Vendor: Acme Corp Ltd';
    const ranges = findFieldRanges(text, {
      vendor: 'Acme Corp Ltd',
      short_name: 'Acme Corp', // contained in the vendor range
    });
    expect(ranges.vendor).toBeDefined();
    expect(ranges.short_name).toBeUndefined();
  });

  it('keeps non-overlapping ranges regardless of field order', () => {
    const ranges = findFieldRanges('A: X-1 B: Y-2', { b: 'Y-2', a: 'X-1' });
    expect(ranges.a).toBeDefined();
    expect(ranges.b).toBeDefined();
  });

  it('returns an empty map for empty data', () => {
    expect(findFieldRanges(INVOICE_TEXT, {})).toEqual({});
    expect(findFieldRanges(INVOICE_TEXT, null as unknown as Record<string, unknown>)).toEqual({});
  });
});
