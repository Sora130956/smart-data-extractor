import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useTranslation } from 'react-i18next';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.tiff,.txt,.md,.csv';

export interface StagedFile {
  id: string;
  name: string;
  sizeBytes: number;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function UploadZone() {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<StagedFile[]>([]);

  // The browser fires dragleave on child elements too; count entries instead.
  const depth = useRef(0);

  function stage(incoming: FileList | null) {
    if (!incoming) return;
    setFiles((prev) => [
      ...prev,
      ...Array.from(incoming).map((f) => ({
        id: `${f.name}-${f.size}-${crypto.randomUUID()}`,
        name: f.name,
        sizeBytes: f.size,
      })),
    ]);
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
    stage(e.dataTransfer.files);
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label={t('upload.title')}
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
        className={`cursor-pointer rounded-card border-2 border-dashed px-5 py-7 text-center transition-colors ${
          dragging
            ? 'border-brand bg-brand/5'
            : 'border-border bg-surface-muted hover:border-text-muted'
        }`}
      >
        <div className="text-[28px] leading-none" aria-hidden>
          📁
        </div>
        <div className="mt-2 font-semibold">
          {dragging ? t('upload.dropActive') : t('upload.title')}
        </div>
        <div className="mx-auto mt-1 max-w-xl text-caption text-text-muted">
          {t('upload.hint')}
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            stage(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {files.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {files.map((file) => (
            <li
              key={file.id}
              className="flex items-center gap-2.5 rounded-token border border-border px-3 py-2 text-body"
            >
              <span aria-hidden>📄</span>
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="tnum text-caption text-text-muted">
                {formatSize(file.sizeBytes)}
              </span>
              <span className="text-caption text-text-muted">{t('upload.pending')}</span>
              <button
                type="button"
                aria-label={`${t('upload.remove')} ${file.name}`}
                onClick={() => setFiles((prev) => prev.filter((f) => f.id !== file.id))}
                className="rounded-token px-1 text-caption text-text-muted hover:text-error"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
