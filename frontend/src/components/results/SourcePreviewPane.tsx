// Issue #4 review pane: shows the original file / extraction text beside
// the field list so reviewers can compare in place instead of opening a
// new tab. Matched field values are highlighted in the text view — warning
// color for fields that need review, success for reviewed ones — and a
// locate click from the field list scrolls to the match and flashes it.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { ExtractionSource } from '@/types/extraction';
import type { FieldRange } from '@/utils/textHighlight';

const FLASH_MS = 1800;

type Tab = 'file' | 'text';

type Segment = { text: string; field?: string };

export interface SourcePreviewPaneProps {
  source: ExtractionSource;
  /** field -> [start, end) into source.sourceText, from findFieldRanges. */
  ranges: Record<string, FieldRange>;
  /** Fields needing review (below threshold or empty) — warning highlight. */
  reviewFields: Set<string>;
  /** Human-reviewed fields — success highlight. */
  reviewedFields: Set<string>;
  /** Locate request from the field list; a fresh nonce re-triggers the
   * scroll+flash (re-clicking the same field must work). */
  focus: { field: string; nonce: number } | null;
}

export function SourcePreviewPane({
  source,
  ranges,
  reviewFields,
  reviewedFields,
  focus,
}: SourcePreviewPaneProps) {
  const { t } = useTranslation();
  const hasFile = source.sourceFileUrl != null;
  const hasText = source.sourceText != null && source.sourceText.length > 0;
  const [tab, setTab] = useState<Tab>(hasFile ? 'file' : 'text');
  const [activeField, setActiveField] = useState<string | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);

  // Locate click: switch to the text view and flash the field's match.
  useEffect(() => {
    if (focus == null || ranges[focus.field] == null) return;
    setTab('text');
    setActiveField(focus.field);
    const timer = setTimeout(() => setActiveField(null), FLASH_MS);
    return () => clearTimeout(timer);
    // ranges is recomputed per result; matching on the nonce is enough here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.field, focus?.nonce]);

  // Once the text view is showing the active match, bring it into view.
  useEffect(() => {
    if (tab !== 'text' || activeField == null) return;
    const el = textRef.current?.querySelector<HTMLElement>(`[data-field="${activeField}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [tab, activeField]);

  const segments = useMemo<Segment[]>(() => {
    const text = source.sourceText ?? '';
    // findFieldRanges never returns overlapping ranges; sort to walk forward.
    const placed = Object.entries(ranges).sort((a, b) => a[1][0] - b[1][0]);
    const out: Segment[] = [];
    let cursor = 0;
    for (const [field, [start, end]] of placed) {
      if (start > cursor) out.push({ text: text.slice(cursor, start) });
      out.push({ text: text.slice(start, end), field });
      cursor = end;
    }
    if (cursor < text.length) out.push({ text: text.slice(cursor) });
    return out;
  }, [source.sourceText, ranges]);

  if (!hasFile && !hasText) {
    return (
      <div className="flex h-full items-center justify-center px-4 py-6 text-center text-caption text-text-muted">
        {t('resultDetail.preview.noSource')}
      </div>
    );
  }

  function markClass(field: string): string {
    const base = 'rounded-xs px-0.5';
    if (field === activeField) return `${base} bg-warning/45 animate-pulse`;
    if (reviewedFields.has(field)) return `${base} bg-success/25`;
    if (reviewFields.has(field)) return `${base} bg-warning/25 ring-1 ring-warning/70`;
    return `${base} bg-brand/15`;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
        {hasFile ? (
          <button
            type="button"
            aria-pressed={tab === 'file'}
            onClick={() => setTab('file')}
            className={`rounded-token px-2 py-1 text-caption font-medium transition-colors ${
              tab === 'file' ? 'bg-brand/12 text-brand' : 'text-text-muted hover:bg-surface-muted'
            }`}
          >
            {t('resultDetail.preview.file')}
          </button>
        ) : null}
        {hasText ? (
          <button
            type="button"
            aria-pressed={tab === 'text'}
            onClick={() => setTab('text')}
            className={`rounded-token px-2 py-1 text-caption font-medium transition-colors ${
              tab === 'text' ? 'bg-brand/12 text-brand' : 'text-text-muted hover:bg-surface-muted'
            }`}
          >
            {t('resultDetail.preview.text')}
          </button>
        ) : null}
        <div className="flex-1" />
        {hasFile ? (
          <a
            href={source.sourceFileUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-token border border-border bg-surface px-2 py-1 text-caption font-medium text-text transition-colors hover:bg-surface-muted"
          >
            <Trans i18nKey="resultDetail.openOriginal" />
          </a>
        ) : null}
      </div>

      {tab === 'file' && hasFile ? (
        <div
          role="region"
          aria-label={t('resultDetail.preview.file')}
          className="min-h-0 flex-1 overflow-auto bg-surface-muted p-2"
        >
          {source.type === 'image' ? (
            <img
              src={source.sourceFileUrl}
              alt={source.name}
              className="mx-auto max-w-full rounded-token border border-border bg-surface"
            />
          ) : (
            <iframe
              title={source.name}
              src={source.sourceFileUrl}
              className="h-full min-h-[420px] w-full rounded-token border border-border bg-surface"
            />
          )}
        </div>
      ) : null}

      {tab === 'text' && hasText ? (
        <div
          role="region"
          aria-label={t('resultDetail.preview.text')}
          ref={textRef}
          className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5"
        >
          <div className="whitespace-pre-wrap break-words font-mono text-code leading-relaxed">
            {segments.map((seg, i) =>
              seg.field ? (
                <mark key={i} data-field={seg.field} className={markClass(seg.field)}>
                  {seg.text}
                </mark>
              ) : (
                <span key={i}>{seg.text}</span>
              ),
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
