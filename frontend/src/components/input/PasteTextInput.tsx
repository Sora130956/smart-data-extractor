import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';

export interface StagedText {
  id: string;
  text: string;
}

interface PasteTextInputProps {
  staged: StagedText[];
  onAdd: (text: string) => void;
  onRemove: (id: string) => void;
}

function preview(text: string): string {
  return text.replace(/\s+/g, ' ').slice(0, 80);
}

export function PasteTextInput({ staged, onAdd, onRemove }: PasteTextInputProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const textareaId = useId();

  function handleAdd() {
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    setDraft('');
  }

  return (
    <div>
      <label className="mb-2 block text-caption font-semibold text-text-muted" htmlFor={textareaId}>
        {t('paste.title')}
      </label>
      <textarea
        id={textareaId}
        className="min-h-[120px] w-full resize-y rounded-card border border-border bg-surface px-3.5 py-3 text-body text-text focus:outline focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
        placeholder={t('paste.placeholder')}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />

      <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
        <Button variant="primary" size="sm" onClick={handleAdd} disabled={!draft.trim()}>
          {t('paste.add')}
        </Button>
        <span className="tnum text-caption text-text-muted">
          {t('paste.charCount', { count: draft.length })}
        </span>
        <div className="flex-1" />
        <span className="text-caption text-text-muted">{t('paste.hint')}</span>
      </div>

      {staged.length > 0 ? (
        <div className="mt-3.5 flex flex-col gap-1.5">
          {staged.map((item, i) => (
            <div
              key={item.id}
              className="flex items-center gap-2.5 rounded-token border border-border px-3 py-2 text-body"
            >
              <span className="tnum w-[52px] flex-none text-caption text-text-muted">
                {t('paste.itemLabel', { index: i + 1 })}
              </span>
              <span className="min-w-0 flex-1 truncate">{preview(item.text)}</span>
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
        <div className="mt-3.5 rounded-card border border-dashed border-border px-4 py-4 text-center text-caption text-text-muted">
          {t('paste.empty')}
        </div>
      )}
    </div>
  );
}
