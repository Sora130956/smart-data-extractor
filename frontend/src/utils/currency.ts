// Cost display: the backend reports both USD (LLM list price) and CNY
// (converted server-side at a configurable rate); the UI picks the currency
// by locale. Single source for every cost figure (StatsStrip, ResultRow).

export function formatCost(usd: number, cny: number, language: string): string {
  const symbol = language.toLowerCase().startsWith('zh') ? '¥' : '$';
  const value = language.toLowerCase().startsWith('zh') ? cny : usd;
  return `${symbol}${value.toFixed(4)}`;
}
