// Maps known backend error codes to i18n keys so the UI can show a
// friendly, localized message instead of the raw error body:
// - 429 quota rejections (demo-stage guard, backend D-019)
// - upstream GLM-OCR failures (issue #13: rate limit / upstream / network)
// Returns null for every other error.

import { ApiError } from '../api/client';

export type QuotaErrorCode = 'quota_per_ip' | 'quota_global';

export function quotaErrorCode(err: unknown): QuotaErrorCode | null {
  if (err instanceof ApiError && err.status === 429) {
    return err.code === 'quota_global' ? 'quota_global' : 'quota_per_ip';
  }
  return null;
}

export function quotaI18nKey(code: QuotaErrorCode): string {
  return code === 'quota_global' ? 'quota.global' : 'quota.perIp';
}

export type OcrErrorCode = 'ocr_rate_limited' | 'ocr_upstream_error' | 'ocr_network_error';

const OCR_ERROR_CODES: readonly OcrErrorCode[] = [
  'ocr_rate_limited',
  'ocr_upstream_error',
  'ocr_network_error',
];

export function ocrErrorCode(err: unknown): OcrErrorCode | null {
  if (err instanceof ApiError && err.code) {
    return OCR_ERROR_CODES.includes(err.code as OcrErrorCode)
      ? (err.code as OcrErrorCode)
      : null;
  }
  return null;
}

export function ocrI18nKey(code: OcrErrorCode): string {
  switch (code) {
    case 'ocr_rate_limited':
      return 'ocr.rateLimited';
    case 'ocr_upstream_error':
      return 'ocr.upstreamError';
    case 'ocr_network_error':
      return 'ocr.networkError';
  }
}

/** Combined lookup: the i18n key for any known friendly error, else null. */
export function friendlyErrorKey(err: unknown): string | null {
  const quota = quotaErrorCode(err);
  if (quota) return quotaI18nKey(quota);
  const ocr = ocrErrorCode(err);
  if (ocr) return ocrI18nKey(ocr);
  return null;
}

/** True when the failed parse was rate-limited — the frontend can re-send
 * it after a pause instead of surfacing an error (issue #13 follow-up).
 * Upstream/network failures are not self-healable and surface immediately. */
export function isOcrAutoRetryable(err: unknown): boolean {
  return ocrErrorCode(err) === 'ocr_rate_limited';
}
