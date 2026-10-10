import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { parseImage, parsePdf } from '@/api/client';
import { useUiStore } from '@/store/uiStore';
import type { OcrBlock } from '@/types/extraction';
import { quotaErrorCode, quotaI18nKey } from '@/utils/errors';

const ACCEPT = '.txt,.pdf,.png,.jpg,.jpeg,.bmp';
// Extensions the backend /parse_image endpoint accepts (GLM vision formats).
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'bmp']);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

export interface StagedText {
  id: string;
  name: string;
  text: string;
  fileUrl?: string;
  /** Upload kind for fileUrl ('pdf' | 'image'); undefined for plain text —
   * the review pane (issue #4) picks its preview strategy from it. */
  fileType?: 'pdf' | 'image';
  /** Per-page base64 renders for pdf uploads (D-027): the whole document in
   * "whole" mode, or just this source's page in "pages" split mode. The
   * review pane overlays grounding boxes on these instead of an iframe. */
  pageImages?: string[];
  /** Per-page OCR grounding blocks (D-028), aligned with the source's
   * pages — the review pane matches extracted values against them locally. */
  pagesBlocks?: Array<OcrBlock[] | null>;
}

interface PasteTextInputProps {
  staged: StagedText[];
  onAdd: (
    name: string,
    text: string,
    fileUrl?: string,
    fileType?: 'pdf' | 'image',
    pageImages?: string[],
    pagesBlocks?: Array<OcrBlock[] | null>,
  ) => void;
  onRemove: (id: string) => void;
}

export function PasteTextInput({ staged, onAdd, onRemove }: PasteTextInputProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const pdfSplitMode = useUiStore((s) => s.pdfSplitMode);

  // The browser fires dragleave on child elements too; count entries instead.
  const depth = useRef(0);

  async function stage(fileList: FileList | null) {
    if (!fileList) return;
    const files = Array.from(fileList);
    const txtFiles = files.filter((f) => f.name.toLowerCase().endsWith('.txt'));
    const pdfFiles = files.filter((f) => f.name.toLowerCase().endsWith('.pdf'));
    const imageFiles = files.filter((f) => IMAGE_EXTENSIONS.has(extensionOf(f.name)));

    await Promise.all(
      txtFiles.map(async (file) => {
        const text = await file.text();
        onAdd(file.name, text);
      }),
    );

    setParsing(true);
    try {
      await Promise.all([
        ...pdfFiles.map(async (file) => {
          try {
            const fileUrl = URL.createObjectURL(file);
            const result = await parsePdf(file);
            if (pdfSplitMode === 'pages') {
              // Failed pages come back as null; index+1 is the original page number.
              result.pages.forEach((page, i) => {
                if (page === null) return;
                // One single-image array per source: just this page's render.
                const render = result.pages_images?.[i];
                const pageImages = render ? [render] : undefined;
                const blocks = result.pages_blocks?.[i];
                const pagesBlocks = blocks ? [blocks] : undefined;
                onAdd(`${file.name} · P${i + 1}`, page, fileUrl, 'pdf', pageImages, pagesBlocks);
              });
            } else {
              onAdd(
                file.name,
                result.text,
                fileUrl,
                'pdf',
                result.pages_images ?? undefined,
                result.pages_blocks ?? undefined,
              );
            }
          } catch (err) {
            const quota = quotaErrorCode(err);
            const message = quota
              ? t(quotaI18nKey(quota))
              : err instanceof Error ? err.message : String(err);
            setParseErrors((prev) => [...prev, message]);
          }
        }),
        // Images have no pages to split: one image = one source, always whole.
        ...imageFiles.map(async (file) => {
          try {
            const fileUrl = URL.createObjectURL(file);
            const result = await parseImage(file);
            onAdd(
              file.name,
              result.text,
              fileUrl,
              'image',
              undefined,
              result.pages_blocks ?? undefined,
            );
          } catch (err) {
            const quota = quotaErrorCode(err);
            const message = quota
              ? t(quotaI18nKey(quota))
              : err instanceof Error ? err.message : String(err);
            setParseErrors((prev) => [...prev, message]);
          }
        }),
      ]);
    } finally {
      setParsing(false);
    }
  }

  function onDragEnter(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    depth.current += 1;
    setDragging(true);
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    depth.current -= 1;
    if (depth.current <= 0) {
      depth.current = 0;
      setDragging(false);
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    void stage(e.dataTransfer.files);
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <div className="min-w-0 flex-1">
        <div
          role="button"
          tabIndex={0}
          aria-label={t('paste.title')}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragEnter={onDragEnter}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={`flex h-full min-h-[120px] cursor-pointer flex-col items-center justify-center rounded-card border-2 border-dashed px-4 py-4 text-center transition-colors ${
            dragging ? 'border-brand bg-brand/5' : 'border-border bg-surface-muted hover:border-text-muted'
          }`}
        >
          <div className="text-[28px] leading-none" aria-hidden>
            📄
          </div>
          <div className="mt-2 text-body font-semibold">
            {dragging ? t('paste.dropActive') : t('paste.title')}
          </div>
          <div className="mt-1 text-caption text-text-muted">{t('paste.hint')}</div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              void stage(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
        {parseErrors.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {parseErrors.map((message, i) => (
              <div key={i} className="text-caption text-error">
                {message}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {staged.length > 0 && (
          <div className="flex max-h-[320px] flex-col gap-1.5 overflow-y-auto pr-1">
            {staged.map((item, i) => (
              <div key={item.id} className="flex items-center gap-2.5 rounded-token border border-border px-3 py-2 text-body">
                <span className="tnum w-[52px] flex-none text-caption text-text-muted">
                  {t('paste.itemLabel', { index: i + 1 })}
                </span>
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <span className="tnum flex-none text-caption text-text-muted">
                  {t('paste.itemChars', { count: item.text.length })}
                </span>
                <button
                  type="button"
                  aria-label={`${t('paste.remove')} ${t('paste.itemLabel', { index: i + 1 })}`}
                  onClick={() => onRemove(item.id)}
                  className="flex-none rounded-token px-1 text-caption text-text-muted hover:text-error"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        {parsing ? (
          <div
            role="status"
            aria-live="polite"
            className={`flex items-center justify-center gap-2 rounded-card border border-dashed border-border px-4 py-4 text-center text-caption text-text-muted ${
              staged.length > 0 ? 'mt-1.5 py-2' : 'h-full min-h-[120px]'
            }`}
          >
            <span
              className="inline-block h-4 w-4 flex-none animate-spin rounded-full border-2 border-border border-t-brand"
              aria-hidden
            />
            {t('paste.parsing')}
          </div>
        ) : staged.length === 0 ? (
          <div className="flex h-full min-h-[120px] items-center justify-center rounded-card border border-dashed border-border px-4 py-4 text-center text-caption text-text-muted">
            {t('paste.empty')}
          </div>
        ) : null}
      </div>
    </div>
  );
}
