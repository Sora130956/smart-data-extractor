import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useTranslation } from 'react-i18next';

const ACCEPT = '.txt';

export interface StagedText {
  id: string;
  name: string;
  text: string;
}

interface PasteTextInputProps {
  staged: StagedText[];
  onAdd: (name: string, text: string) => void;
  onRemove: (id: string) => void;
}

export function PasteTextInput({ staged, onAdd, onRemove }: PasteTextInputProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // The browser fires dragleave on child elements too; count entries instead.
  const depth = useRef(0);

  async function stage(fileList: FileList | null) {
    if (!fileList) return;
    const txtFiles = Array.from(fileList).filter((f) => f.name.toLowerCase().endsWith('.txt'));
    await Promise.all(
      txtFiles.map(async (file) => {
        const text = await file.text();
        onAdd(file.name, text);
      }),
    );
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
      </div>

      <div className="min-w-0 flex-1">
        {staged.length > 0 ? (
          <div className="flex flex-col gap-1.5">
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
        ) : (
          <div className="flex h-full min-h-[120px] items-center justify-center rounded-card border border-dashed border-border px-4 py-4 text-center text-caption text-text-muted">
            {t('paste.empty')}
          </div>
        )}
      </div>
    </div>
  );
}
