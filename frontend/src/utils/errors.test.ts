import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import {
  friendlyErrorKey,
  ocrErrorCode,
  ocrI18nKey,
  quotaErrorCode,
  quotaI18nKey,
} from './errors';

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

describe('ocrErrorCode (upstream GLM-OCR failures, issue #13)', () => {
  it('maps the three structured ocr codes by code, regardless of status', () => {
    expect(ocrErrorCode(new ApiError('busy', 503, 'ocr_rate_limited'))).toBe('ocr_rate_limited');
    expect(ocrErrorCode(new ApiError('failed', 502, 'ocr_upstream_error'))).toBe('ocr_upstream_error');
    expect(ocrErrorCode(new ApiError('unreachable', 503, 'ocr_network_error'))).toBe('ocr_network_error');
  });

  it('returns null for other codes and non-API errors', () => {
    expect(ocrErrorCode(new ApiError('boom', 503, 'other_code'))).toBeNull();
    expect(ocrErrorCode(new ApiError('no code', 503))).toBeNull();
    expect(ocrErrorCode(new Error('network'))).toBeNull();
    expect(ocrErrorCode('str')).toBeNull();
  });

  it('maps codes to i18n keys', () => {
    expect(ocrI18nKey('ocr_rate_limited')).toBe('ocr.rateLimited');
    expect(ocrI18nKey('ocr_upstream_error')).toBe('ocr.upstreamError');
    expect(ocrI18nKey('ocr_network_error')).toBe('ocr.networkError');
  });
});

describe('friendlyErrorKey', () => {
  it('resolves quota codes', () => {
    expect(friendlyErrorKey(new ApiError('daily limit', 429, 'quota_global'))).toBe('quota.global');
  });

  it('resolves ocr codes', () => {
    expect(friendlyErrorKey(new ApiError('busy', 503, 'ocr_rate_limited'))).toBe('ocr.rateLimited');
  });

  it('returns null when no friendly key applies', () => {
    expect(friendlyErrorKey(new ApiError('boom', 400, 'bad_request'))).toBeNull();
    expect(friendlyErrorKey(new Error('network'))).toBeNull();
    expect(friendlyErrorKey('str')).toBeNull();
  });
});
