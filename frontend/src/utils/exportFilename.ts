// Export filename convention: template label + compact local timestamp,
// e.g. "发票信息-20261009-104500.xlsx". Shared by the JSON and Excel
// exports in ResultsHeader and ResultDetailModal.

const ILLEGAL_FILENAME_RE = /[\\/:*?"<>|]/g;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function buildExportFilename(label: string, ext: string, now: Date = new Date()): string {
  const safe = label.replace(ILLEGAL_FILENAME_RE, '_').trim() || 'export';
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${safe}-${stamp}.${ext}`;
}
