// Issue #4 review pane: shows the original file / extraction text beside
// the field list so reviewers can compare in place instead of opening a
// new tab. D-028: the file view renders the original as page images with
// the grounding boxes overlaid directly on them — warning color for fields
// that need review, success for reviewed ones — so a reviewer verifies a
// low-confidence value against the source image at a glance. The boxes are
// matched locally from the OCR grounding blocks (no extra model call). A
// locate click jumps to the box's page and flashes it; PDFs without page
// renders (legacy data) fall back to the iframe embed, and the text view
// keeps the issue #4 inline highlights as the fallback.

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
  /** Field currently being edited, if any — its box/highlight stays shown
   * for the duration of the edit instead of flashing and fading. */
  editingField: string | null;
  /** field -> where its value sits in the original file (D-028), matched
   * locally from the OCR grounding blocks. Drives the file-view overlays. */
  boxes: Record<string, FieldBox>;
}

export function SourcePreviewPane({
  source,
  ranges,
  reviewFields,
  reviewedFields,
  focus,
  editingField,
  boxes,
}: SourcePreviewPaneProps) {
  const { t } = useTranslation();
  const hasFile = source.sourceFileUrl != null;
  const hasText = source.sourceText != null && source.sourceText.length > 0;
  const [tab, setTab] = useState<Tab>(hasFile ? 'file' : 'text');
  // The locate flash fades on its own timer; an in-progress edit takes
  // priority and stays shown for as long as the field is being edited. Only
  // one field's box/highlight is ever shown at a time (not every matched
  // field) so the preview reflects what the user is looking at right now.
  const [flashField, setFlashField] = useState<string | null>(null);
  const activeField = editingField ?? flashField;
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

  // Locate click: prefer the grounding box (jump to its page on the file view
  // and flash it); fall back to the text-view highlight when there is none.
  useEffect(() => {
    if (focus == null) return;
    const box = boxes[focus.field];
    if (box != null) {
      setTab('file');
      if (pages.length > 0) {
        setPageIndex(Math.min(Math.max(box.page, 0), pages.length - 1));
      }
      setFlashField(focus.field);
    } else if (ranges[focus.field] != null) {
      setTab('text');
      setFlashField(focus.field);
    } else {
      return;
    }
    const timer = setTimeout(() => setFlashField(null), FLASH_MS);
    return () => clearTimeout(timer);
    // ranges/boxes are recomputed per result; matching on the nonce is
    // enough here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.field, focus?.nonce]);

  // Starting an edit switches to whichever view holds the field (unlike a
  // locate click, it does not force a page jump — the user may already be
  // looking at a different page on purpose). The highlight stays up for as
  // long as the field is being edited (editingField going back to null
  // clears it via the activeField fallback above).
  useEffect(() => {
    if (editingField == null) return;
    if (boxes[editingField] != null) {
      setTab('file');
    } else if (ranges[editingField] != null) {
      setTab('text');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingField]);

  // Once the text view is showing the active match, bring it into view.
  useEffect(() => {
    if (tab !== 'text' || activeField == null) return;
    const el = textRef.current?.querySelector<HTMLElement>(`[data-field="${activeField}"]`);
    el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
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

  // A locate flash always pulses in warning color regardless of review state
  // (it's a "look here" cue, not a status). An in-progress edit instead keeps
  // the field's normal review-state color so it doesn't look like a warning
  // just because it's being edited.
  function markClass(field: string): string {
    const base = 'rounded-xs px-0.5';
    if (field === flashField) return `${base} bg-warning/45 animate-pulse`;
    if (reviewedFields.has(field)) return `${base} bg-success/25`;
    if (reviewFields.has(field)) return `${base} bg-warning/25 ring-1 ring-warning/70`;
    return `${base} bg-brand/15`;
  }

  function boxClass(field: string): string {
    const base = 'pointer-events-none absolute rounded-xs';
    if (field === flashField) return `${base} bg-warning/40 ring-2 ring-warning animate-pulse`;
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
                {activeField != null &&
                boxes[activeField] != null &&
                boxes[activeField].page === safeIndex ? (
                  <div
                    data-field={activeField}
                    className={boxClass(activeField)}
                    style={{
                      left: `${boxes[activeField].box[0]}%`,
                      top: `${boxes[activeField].box[1]}%`,
                      width: `${boxes[activeField].box[2] - boxes[activeField].box[0]}%`,
                      height: `${boxes[activeField].box[3] - boxes[activeField].box[1]}%`,
                    }}
                  />
                ) : null}
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
