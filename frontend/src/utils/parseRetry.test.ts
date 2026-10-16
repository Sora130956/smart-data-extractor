import { describe, expect, it, vi } from 'vitest';
import { OCR_AUTO_RETRY_DELAYS_MS, withOcrAutoRetry } from './parseRetry';

const noSleep = async (_ms: number) => {};

describe('withOcrAutoRetry', () => {
  it('returns the first success without waiting', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const sleep = vi.fn(noSleep);
    const onRetry = vi.fn();

    await expect(withOcrAutoRetry(fn, () => true, onRetry, sleep)).resolves.toBe('ok');

    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('waits out the first delay and succeeds on the second attempt', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('429')).mockResolvedValueOnce('ok');
    const sleep = vi.fn(noSleep);
    const onRetry = vi.fn();

    await expect(withOcrAutoRetry(fn, () => true, onRetry, sleep)).resolves.toBe('ok');

    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(OCR_AUTO_RETRY_DELAYS_MS[0]);
    expect(onRetry).toHaveBeenCalledWith(1, OCR_AUTO_RETRY_DELAYS_MS[0]);
  });

  it('throws immediately on a non-retryable failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('bad file'));
    const sleep = vi.fn(noSleep);

    await expect(withOcrAutoRetry(fn, () => false, undefined, sleep)).rejects.toThrow('bad file');

    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('gives up after the configured retries and rethrows the last error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('still 429'));
    const sleep = vi.fn(noSleep);
    const onRetry = vi.fn();

    await expect(withOcrAutoRetry(fn, () => true, onRetry, sleep)).rejects.toThrow('still 429');

    expect(fn).toHaveBeenCalledTimes(1 + OCR_AUTO_RETRY_DELAYS_MS.length);
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([...OCR_AUTO_RETRY_DELAYS_MS]);
    expect(onRetry).toHaveBeenCalledTimes(OCR_AUTO_RETRY_DELAYS_MS.length);
  });

  it('stops mid-ladder when an attempt fails non-retryably', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('429')).mockRejectedValueOnce(new Error('bad file'));
    const sleep = vi.fn(noSleep);
    const is429 = (err: unknown) => (err as Error).message === '429';

    await expect(withOcrAutoRetry(fn, is429, undefined, sleep)).rejects.toThrow('bad file');

    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});
