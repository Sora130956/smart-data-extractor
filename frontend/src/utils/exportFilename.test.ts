import { describe, expect, it } from 'vitest';
import { buildExportFilename } from './exportFilename';

const FIXED = new Date(2026, 9, 9, 10, 45, 30); // 2026-10-09 10:45:30 local

describe('buildExportFilename', () => {
  it('combines the template label, a compact timestamp and the extension', () => {
    expect(buildExportFilename('发票信息', 'xlsx', FIXED)).toBe('发票信息-20261009-104530.xlsx');
    expect(buildExportFilename('Invoice', 'json', FIXED)).toBe('Invoice-20261009-104530.json');
  });

  it('defaults the timestamp to the current time', () => {
    expect(buildExportFilename('Invoice', 'json')).toMatch(/^Invoice-\d{8}-\d{6}\.json$/);
  });

  it('replaces characters that are illegal in Windows filenames', () => {
    expect(buildExportFilename('a/b\\c:d*e?f"g<h>i|j', 'json', FIXED)).toBe(
      'a_b_c_d_e_f_g_h_i_j-20261009-104530.json',
    );
  });
});
