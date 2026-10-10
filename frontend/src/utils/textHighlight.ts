// Issue #4: locate extracted field values inside the source text (OCR text,
// pasted text, .txt content) so the review pane can highlight where each
// value came from. Pure string matching — no position info exists anywhere
// in the extraction pipeline, so "where" is approximated by finding the
// value as a substring of the source, tolerant of case and whitespace
// differences (OCR output frequently re-flows line breaks and spacing).

export type FieldRange = [number, number];

/** Lowercased, whitespace-collapsed form of `text`, with a per-character map
 * back into the ORIGINAL string: `starts[i]`/`ends[i]` delimit the original
 * span (a single char, or one whole whitespace run) that produced normalized
 * char `i`. */
interface NormalizedText {
  normalized: string;
  starts: number[];
  ends: number[];
}

function normalize(text: string): NormalizedText {
  const chars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i])) {
      // Collapse each whitespace run (spaces, newlines, tabs) to one ' '.
      let j = i;
      while (j < text.length && /\s/.test(text[j])) j += 1;
      chars.push(' ');
      starts.push(i);
      ends.push(j);
      i = j;
    } else if (text[i] === ',') {
      // Drop commas symmetrically on both sides: money is the most
      // review-critical value and OCR prints it thousands-separated
      // ("1,234.50") while the LLM returns it bare (1234.5).
      i += 1;
    } else {
      chars.push(text[i].toLowerCase());
      starts.push(i);
      ends.push(i + 1);
      i += 1;
    }
  }
  return { normalized: chars.join(''), starts, ends };
}

/** First occurrence of `value` in `sourceText` as a range into the ORIGINAL
 * text, or null when there is nothing worth locating:
 * - null/undefined/boolean/array/object values have no textual span;
 * - needles shorter than 2 normalized chars match everywhere and would
 *   only produce noise.
 * Matching is case-insensitive and treats any whitespace run as one space. */
export function findFieldRange(sourceText: string, value: unknown): FieldRange | null {
  if (value == null || (typeof value !== 'string' && typeof value !== 'number')) return null;
  const needle = normalize(String(value)).normalized.trim();
  if (needle.length < 2) return null;

  const source = normalize(sourceText);
  const nStart = source.normalized.indexOf(needle);
  if (nStart === -1) return null;

  const start = source.starts[nStart];
  const end = source.ends[nStart + needle.length - 1];
  return [start, end];
}

/** Ranges for every scalar field of `data` found in `sourceText`, keyed by
 * field name. Fields are processed in `data` order; a field whose range
 * overlaps an already-placed one is dropped (e.g. a short name contained in
 * a full vendor name) so highlights never stack. Unmatched/unsuitable
 * fields are simply absent from the result. */
export function findFieldRanges(
  sourceText: string,
  data: Record<string, unknown> | null | undefined,
): Record<string, FieldRange> {
  const ranges: Record<string, FieldRange> = {};
  if (data == null) return ranges;

  const placed: FieldRange[] = [];
  for (const [field, value] of Object.entries(data)) {
    const range = findFieldRange(sourceText, value);
    if (range === null) continue;
    const overlaps = placed.some(([s, e]) => range[0] < e && s < range[1]);
    if (overlaps) continue;
    placed.push(range);
    ranges[field] = range;
  }
  return ranges;
}
