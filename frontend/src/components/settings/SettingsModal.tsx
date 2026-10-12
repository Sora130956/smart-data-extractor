import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore, type PdfSplitMode } from '@/store/uiStore';
import {
  comboFromEvent,
  formatCombo,
  validateComboForBinding,
  type ShortcutAction,
} from '@/utils/shortcuts';

const SPLIT_MODES: PdfSplitMode[] = ['whole', 'pages'];

/** Issue #5: the four rebindable review shortcuts, in display order. */
const SHORTCUT_ROWS: Array<{ action: ShortcutAction; labelKey: string }> = [
  { action: 'nextField', labelKey: 'settings.shortcuts.nextField' },
  { action: 'prevField', labelKey: 'settings.shortcuts.prevField' },
  { action: 'saveNext', labelKey: 'settings.shortcuts.saveNext' },
  { action: 'cancelEdit', labelKey: 'settings.shortcuts.cancelEdit' },
];

export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

function WholeDocIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6M9 15.5h6M9 9h3" />
    </svg>
  );
}

function PagesIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2h7l3 3v11H8z" />
      <path d="M15 2v3h3" />
      <path d="M5 7v13h10" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12l5 5L19 7" />
    </svg>
  );
}

function ModelIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5 5l2.5 2.5M19 5l-2.5 2.5M5 19l2.5-2.5M19 19l-2.5-2.5" />
    </svg>
  );
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { t } = useTranslation();
  const pdfSplitMode = useUiStore((s) => s.pdfSplitMode);
  const setPdfSplitMode = useUiStore((s) => s.setPdfSplitMode);
  const shortcuts = useUiStore((s) => s.shortcuts);
  const setShortcut = useUiStore((s) => s.setShortcut);
  const resetShortcuts = useUiStore((s) => s.resetShortcuts);
  // Issue #5: the action whose keycap is waiting for the next key press,
  // plus the rejection reason of the last attempt (kept so the row stays
  // in recording mode and the user can simply press a valid combo).
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [recordError, setRecordError] = useState<{
    reason: 'invalid' | 'reserved' | 'conflict';
    conflictWith?: string;
  } | null>(null);

  useEffect(() => {
    // While recording, Escape aborts the recording (handled below) — it
    // must not close the whole settings dialog.
    if (!open || recording) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose, recording]);

  useEffect(() => {
    if (!recording) return;
    // Snapshot for the closure below: `recording` itself is not narrowed
    // across function boundaries.
    const action = recording;
    function handleKey(e: KeyboardEvent) {
      // Everything the recorder accepts is swallowed here: Tab must not
      // move focus, Ctrl+S must not open the browser save dialog.
      e.preventDefault();
      if (e.key === 'Escape') {
        setRecording(null);
        setRecordError(null);
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return; // bare modifier press: keep waiting for the key
      const formatted = formatCombo(combo);
      const otherCombos = SHORTCUT_ROWS.filter((row) => row.action !== action).map(
        (row) => shortcuts[row.action],
      );
      const check = validateComboForBinding(combo, otherCombos);
      if (check === 'ok') {
        setShortcut(action, formatted);
        setRecording(null);
        setRecordError(null);
      } else if (check === 'conflict') {
        const conflictWith = SHORTCUT_ROWS.find(
          (row) => row.action !== action && shortcuts[row.action] === formatted,
        )?.labelKey;
        setRecordError({ reason: 'conflict', conflictWith });
      } else {
        setRecordError({ reason: check });
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [recording, shortcuts, setShortcut]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.title')}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-card border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-4.5 py-3.5">
          <div className="text-title font-semibold">{t('settings.title')}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('settings.close')}
            className="text-text-muted hover:text-text"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-6 px-5 py-5">
          <section className="flex flex-col gap-3">
            <div className="text-caption font-medium text-text-muted">
              {t('settings.groupParsing')}
            </div>
            <div
              role="group"
              aria-label={t('settings.pdfSplitMode')}
              className="grid grid-cols-2 gap-2.5"
            >
              {SPLIT_MODES.map((mode) => {
                const active = pdfSplitMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={active}
                    aria-label={t(`settings.splitMode.${mode}`)}
                    onClick={() => setPdfSplitMode(mode)}
                    className={`relative flex flex-col items-start gap-2 rounded-card border p-3 text-left transition-colors ${
                      active
                        ? 'border-brand bg-brand/8'
                        : 'border-border bg-surface hover:bg-surface-muted'
                    }`}
                  >
                    {active && (
                      <span className="absolute right-2.5 top-2.5 grid size-4 place-items-center rounded-full bg-brand text-on-brand">
                        <CheckIcon />
                      </span>
                    )}
                    <span
                      className={`grid size-8 place-items-center rounded-token ${
                        active ? 'bg-brand/15 text-brand' : 'bg-surface-muted text-text-muted'
                      }`}
                    >
                      {mode === 'whole' ? <WholeDocIcon /> : <PagesIcon />}
                    </span>
                    <span className="text-body font-medium text-text">
                      {t(`settings.splitMode.${mode}`)}
                    </span>
                    <span className="text-caption text-text-muted">
                      {t(`settings.splitModeHint.${mode}`)}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="flex flex-col gap-3 border-t border-border pt-5">
            <div className="flex items-center justify-between">
              <div className="text-caption font-medium text-text-muted">
                {t('settings.groupShortcuts')}
              </div>
              <button
                type="button"
                onClick={() => {
                  resetShortcuts();
                  setRecording(null);
                  setRecordError(null);
                }}
                className="rounded-token px-1.5 py-0.5 text-caption text-text-muted hover:text-brand"
              >
                {t('settings.shortcuts.reset')}
              </button>
            </div>
            <div className="flex flex-col overflow-hidden rounded-card border border-border">
              {SHORTCUT_ROWS.map(({ action, labelKey }, index) => {
                const isRecording = recording === action;
                return (
                  <div
                    key={action}
                    className={`flex items-center justify-between gap-3 px-3.5 py-2.5 ${
                      index > 0 ? 'border-t border-border' : ''
                    }`}
                  >
                    <span className="text-body text-text">{t(labelKey)}</span>
                    <button
                      type="button"
                      aria-label={t('settings.shortcuts.rebind', { action: t(labelKey) })}
                      onClick={() => {
                        setRecording(isRecording ? null : action);
                        setRecordError(null);
                      }}
                      className={`min-w-[96px] flex-none rounded-token border px-2 py-1 text-center text-caption ${
                        isRecording
                          ? 'animate-pulse border-brand bg-brand/10 text-brand'
                          : 'border-border bg-surface-muted text-text hover:border-brand hover:text-brand'
                      }`}
                    >
                      {isRecording ? t('settings.shortcuts.recording') : shortcuts[action]}
                    </button>
                  </div>
                );
              })}
            </div>
            {recordError ? (
              <p className="text-caption text-error">
                {recordError.conflictWith
                  ? t('settings.shortcuts.error.conflict', { action: t(recordError.conflictWith) })
                  : t(`settings.shortcuts.error.${recordError.reason}`)}
              </p>
            ) : null}
          </section>

          <section className="flex flex-col gap-3 border-t border-border pt-5">
            <div className="text-caption font-medium text-text-muted">
              {t('settings.groupModel')}
            </div>
            <div className="flex items-center gap-3 rounded-card border border-border bg-surface-muted px-3.5 py-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-token border border-border bg-surface text-text-muted">
                <ModelIcon />
              </span>
              <div className="flex-1">
                <div className="text-body font-medium text-text">{t('settings.defaultModel')}</div>
                <p className="mt-0.5 text-caption text-text-muted">{t('settings.modelHint')}</p>
              </div>
              <span className="shrink-0 rounded-token border border-border bg-surface px-2 py-0.5 text-caption text-text-muted">
                {t('settings.comingSoon')}
              </span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
