// Maps 429 quota rejections (demo-stage guard, backend D-019) to an i18n
// key so the UI can show a friendly, localized message instead of the raw
// error body. Returns null for every other error.

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
