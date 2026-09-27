import { confidenceLevel, formatConfidence } from '@/utils/confidence';

const FILL: Record<ReturnType<typeof confidenceLevel>, string> = {
  high: 'bg-success',
  medium: 'bg-warning',
  low: 'bg-error',
};

const TEXT: Record<ReturnType<typeof confidenceLevel>, string> = {
  high: 'text-success',
  medium: 'text-warning',
  low: 'text-error',
};

/**
 * The one loud element in this interface (DESIGN.md §2 D-F04).
 * §7: the bar never carries the signal alone — the number always ships with it.
 */
export function ConfidenceBar({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span className="flex w-[132px] items-center justify-end">
        <span className="tnum w-[34px] text-right text-caption text-text-muted">—</span>
      </span>
    );
  }

  const level = confidenceLevel(value);

  return (
    <span className="flex w-[132px] items-center gap-2">
      <span className="h-1 w-[76px] overflow-hidden rounded-full bg-border">
        <span
          className={`block h-full rounded-full ${FILL[level]}`}
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </span>
      <span className={`tnum w-[34px] text-right text-caption ${TEXT[level]}`}>
        {formatConfidence(value)}
      </span>
    </span>
  );
}
