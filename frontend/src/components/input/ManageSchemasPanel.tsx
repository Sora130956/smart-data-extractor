// Modal for renaming/deleting locally-saved schemas (the "smart" inference
// flow's output). Mirrors HistoryPanel's modal shell (role=dialog, Escape
// to close, backdrop click to close).

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { savedSchemaLabel, useUiStore } from '@/store/uiStore';

export function ManageSchemasPanel({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const savedSchemas = useUiStore((s) => s.savedSchemas);
  const renameSavedSchema = useUiStore((s) => s.renameSavedSchema);
  const deleteSavedSchema = useUiStore((s) => s.deleteSavedSchema);
  const isZh = (i18n.resolvedLanguage ?? 'en').startsWith('zh');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  function startRename(id: string, currentName: string) {
    setDeletingId(null);
    setRenamingId(id);
    setRenameValue(currentName);
  }

  function commitRename() {
    if (renamingId && renameValue.trim()) {
      renameSavedSchema(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('manageSchemas.title')}
        className="max-h-[90vh] w-full max-w-[480px] overflow-y-auto rounded-card border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4.5 py-3.5">
          <div className="text-title font-semibold">{t('manageSchemas.title')}</div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label={t('manageSchemas.close')}
            className="text-text-muted hover:text-text"
          >
            ✕
          </button>
        </div>

        {savedSchemas.length === 0 ? (
          <p className="px-4.5 py-8 text-center text-caption text-text-muted">
            {t('manageSchemas.empty')}
          </p>
        ) : (
          <ul className="flex flex-col">
            {savedSchemas.map((schema) => (
              <li key={schema.id} className="border-b border-border px-4.5 py-3 last:border-b-0">
                {renamingId === schema.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      className="flex-1 rounded-token border border-border bg-surface px-2 py-1 text-body text-text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                    />
                    <Button size="sm" variant="primary" onClick={commitRename}>
                      {t('manageSchemas.rename')}
                    </Button>
                  </div>
                ) : deletingId === schema.id ? (
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-caption text-text">
                      {t('manageSchemas.confirmDelete', { name: savedSchemaLabel(schema, isZh) })}
                    </span>
                    <Button size="sm" onClick={() => setDeletingId(null)}>
                      {t('manageSchemas.cancel')}
                    </Button>
                    <Button size="sm" variant="primary" onClick={() => deleteSavedSchema(schema.id)}>
                      {t('manageSchemas.delete')}
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="flex flex-1 flex-col">
                      <span className="text-body font-semibold">{savedSchemaLabel(schema, isZh)}</span>
                      <span className="text-caption text-text-muted">
                        {t('manageSchemas.fieldsCount', { count: schema.fields.length })}
                      </span>
                    </div>
                    <Button size="sm" onClick={() => startRename(schema.id, savedSchemaLabel(schema, isZh))}>
                      {t('manageSchemas.rename')}
                    </Button>
                    <Button size="sm" onClick={() => setDeletingId(schema.id)}>
                      {t('manageSchemas.delete')}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
