import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { quotaErrorCode, quotaI18nKey } from './errors';

describe('quotaErrorCode', () => {
  it('maps a 429 with per-ip code', () => {
    const err = new ApiError('daily limit', 429, 'quota_per_ip');
    expect(quotaErrorCode(err)).toBe('quota_per_ip');
  });

  it('maps a 429 with global code', () => {
    const err = new ApiError('service limit', 429, 'quota_global');
    expect(quotaErrorCode(err)).toBe('quota_global');
  });

  it('defaults a 429 without code to per-ip (the common case)', () => {
    const err = new ApiError('Too Many Requests', 429);
    expect(quotaErrorCode(err)).toBe('quota_per_ip');
  });

  it('returns null for non-429 API errors and non-API errors', () => {
    expect(quotaErrorCode(new ApiError('boom', 400))).toBeNull();
    expect(quotaErrorCode(new Error('network'))).toBeNull();
    expect(quotaErrorCode('str')).toBeNull();
  });

  it('maps codes to i18n keys', () => {
    expect(quotaI18nKey('quota_per_ip')).toBe('quota.perIp');
    expect(quotaI18nKey('quota_global')).toBe('quota.global');
  });
});
