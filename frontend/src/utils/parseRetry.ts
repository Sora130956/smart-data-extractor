// Frontend self-healing for rate-limited OCR parses (issue #13 follow-up).
// When the backend's retry ladder is exhausted and the failure was a rate
// limit, re-send after a pause instead of failing the upload: the backend
// AIMD pacer uses that pause to back off, so a later attempt usually gets
// through. Only rate-limited failures retry — real upstream/network errors
// still surface immediately (see isOcrAutoRetryable).

export const OCR_AUTO_RETRY_DELAYS_MS: readonly number[] = [8_000, 15_000, 30_000];

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn`, retrying retryable failures after fixed delays (no jitter:
 * each client sends at most a handful of files, far from a thundering herd).
 * Rethrows the last error once the ladder is exhausted, or immediately on
 * a non-retryable failure. `sleep` is injectable for tests.
 */
export async function withOcrAutoRetry<T>(
  fn: () => Promise<T>,
  isRetryable: (err: unknown) => boolean,
  onRetry?: (attempt: number, delayMs: number) => void,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= OCR_AUTO_RETRY_DELAYS_MS.length || !isRetryable(err)) throw err;
      const delay = OCR_AUTO_RETRY_DELAYS_MS[attempt];
      onRetry?.(attempt + 1, delay);
      await sleep(delay);
    }
  }
}
