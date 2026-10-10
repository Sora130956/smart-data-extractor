// Issue #4 review pane: shows the original file / extraction text beside
// the field list so reviewers can compare in place instead of opening a
// new tab. D-027: the file view renders the original as page images with
// the locate boxes overlaid directly on them — warning color for fields
// that need review, success for reviewed ones — so a reviewer verifies a
// low-confidence value against the source image at a glance. A locate
// click jumps to the box's page and flashes it; PDFs without page renders
// (legacy data) fall back to the iframe embed, and the text view keeps the
// issue #4 inline highlights as the no-vision fallback.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { ExtractionSource, FieldBox } from '@/types/extraction';
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
  /** field -> where its value sits in the original file (D-027), from
   * /locate_fields via the detail modal. Drives the file-view overlays. */
  boxes: Record<string, FieldBox>;
  /** True while the modal's background /locate_fields call is running. */
  locating?: boolean;
}

export function SourcePreviewPane({
  source,
  ranges,
  reviewFields,
  reviewedFields,
  focus,
  boxes,
  locating = false,
}: SourcePreviewPaneProps) {
  const { t } = useTranslation();
  const hasFile = source.sourceFileUrl != null;
  const hasText = source.sourceText != null && source.sourceText.length > 0;
  const [tab, setTab] = useState<Tab>(hasFile ? 'file' : 'text');
  const [activeField, setActiveField] = useState<string | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);

  // Pages shown in the file view: the backend's per-page renders for pdfs
  // (base64 -> data url), or the image blob url as a single page.
  const pages = useMemo<string[]>(() => {
    if (source.type === 'pdf') {
      return (source.pageImages ?? []).map((b64) => `data:image/png;base64,${b64}`);
    }
    if (source.type === 'image' && source.sourceFileUrl != null) {
      return [source.sourceFileUrl];
    }
    return [];
  }, [source.type, source.pageImages, source.sourceFileUrl]);

  const [pageIndex, setPageIndex] = useState(0);
  // Stay in range when a rerender shrinks the page list.
  const safeIndex = Math.min(pageIndex, Math.max(pages.length - 1, 0));

  // Locate click: prefer the vision box (jump to its page on the file view
  // and flash it); fall back to the text-view highlight when there is none.
  useEffect(() => {
    if (focus == null) return;
    const box = boxes[focus.field];
    if (box != null) {
      setTab('file');
      if (box.page != null && pages.length > 0) {
        setPageIndex(Math.min(Math.max(box.page, 0), pages.length - 1));
      }
      setActiveField(focus.field);
    } else if (ranges[focus.field] != null) {
      setTab('text');
      setActiveField(focus.field);
    } else {
      return;
    }
    const timer = setTimeout(() => setActiveField(null), FLASH_MS);
    return () => clearTimeout(timer);
    // ranges/boxes are recomputed per result; matching on the nonce is
    // enough here.
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

  function boxClass(field: string): string {
    const base = 'pointer-events-none absolute rounded-xs';
    if (field === activeField) return `${base} bg-warning/40 ring-2 ring-warning animate-pulse`;
    if (reviewedFields.has(field)) return `${base} bg-success/20 ring-2 ring-success/70`;
    if (reviewFields.has(field)) return `${base} bg-warning/25 ring-2 ring-warning/70`;
    return `${base} bg-brand/15 ring-2 ring-brand/60`;
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
        {tab === 'file' && locating ? (
          <span className="flex items-center gap-1.5 text-caption text-text-muted">
            <span
              className="inline-block h-3 w-3 flex-none animate-spin rounded-full border-2 border-border border-t-brand"
              aria-hidden
            />
            {t('resultDetail.preview.locating')}
          </span>
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
        <div className="flex min-h-0 flex-1 flex-col">
          {pages.length > 1 ? (
            <div className="flex items-center justify-center gap-3 border-b border-border px-3 py-1.5 text-caption text-text-muted">
              <button
                type="button"
                aria-label={t('resultDetail.preview.prevPage')}
                disabled={safeIndex === 0}
                onClick={() => setPageIndex(safeIndex - 1)}
                className="rounded-token px-1.5 disabled:opacity-30 hover:bg-surface-muted"
              >
                ‹
              </button>
              <span className="tnum">
                {t('resultDetail.preview.pageOf', { page: safeIndex + 1, total: pages.length })}
              </span>
              <button
                type="button"
                aria-label={t('resultDetail.preview.nextPage')}
                disabled={safeIndex === pages.length - 1}
                onClick={() => setPageIndex(safeIndex + 1)}
                className="rounded-token px-1.5 disabled:opacity-30 hover:bg-surface-muted"
              >
                ›
              </button>
            </div>
          ) : null}
          <div
            role="region"
            aria-label={t('resultDetail.preview.file')}
            className="min-h-0 flex-1 overflow-auto bg-surface-muted p-2"
          >
            {pages.length > 0 ? (
              <div className="relative mx-auto w-fit max-w-full">
                <img
                  src={pages[safeIndex]}
                  alt={source.name}
                  className="max-w-full rounded-token border border-border bg-surface"
                />
                {Object.entries(boxes)
                  .filter(([, box]) => (box.page ?? 0) === safeIndex)
                  .map(([field, box]) => (
                    <div
                      key={field}
                      data-field={field}
                      className={boxClass(field)}
                      style={{
                        left: `${box.box[0]}%`,
                        top: `${box.box[1]}%`,
                        width: `${box.box[2] - box.box[0]}%`,
                        height: `${box.box[3] - box.box[1]}%`,
                      }}
                    />
                  ))}
              </div>
            ) : source.type === 'image' ? (
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
