import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ApiError, sendFeedback } from '@/api/client';

/** Mirrors the backend's FeedbackRequest max length (schemas.py). */
const MAX_MESSAGE = 2000;
const MAX_CONTACT = 200;

type Phase = 'editing' | 'sending' | 'sent';

/** Maps known backend error codes (api/feedback.py + quota relabel) to
 * localized copy; everything else falls back to the raw message. */
function feedbackErrorText(err: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'feedback_quota':
        return t('feedback.errorQuota');
      case 'feedback_not_configured':
        return t('feedback.errorNotConfigured');
      case 'feedback_send_failed':
        return t('feedback.errorSendFailed');
      default:
        return t('feedback.errorGeneric', { message: err.message });
    }
  }
  return t('feedback.errorGeneric', { message: err instanceof Error ? err.message : String(err) });
}

export interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
}

export function FeedbackModal({ open, onClose }: FeedbackModalProps) {
  const { t } = useTranslation();
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [phase, setPhase] = useState<Phase>('editing');
  const [error, setError] = useState<string | null>(null);

  // Reset the draft whenever the dialog closes, so reopening starts fresh.
  useEffect(() => {
    if (!open) {
      setMessage('');
      setContact('');
      setPhase('editing');
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit() {
    const text = message.trim();
    if (!text || phase === 'sending') return;
    setPhase('sending');
    setError(null);
    try {
      await sendFeedback(text, contact.trim() || undefined);
      setPhase('sent');
    } catch (err) {
      setPhase('editing');
      setError(feedbackErrorText(err, t));
    }
  }

  const canSend = phase === 'editing' && message.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('feedback.title')}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-card border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-4.5 py-3.5">
          <div className="text-title font-semibold">{t('feedback.title')}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('feedback.done')}
            className="text-text-muted hover:text-text"
          >
            ✕
          </button>
        </div>

        {phase === 'sent' ? (
          <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
            <span
              aria-hidden
              className="grid size-10 place-items-center rounded-full bg-success/15 text-xl text-success"
            >
              ✓
            </span>
            <p className="text-body font-medium text-text">{t('feedback.sent')}</p>
            <p className="text-caption text-text-muted">{t('feedback.sentHint')}</p>
            <Button size="sm" onClick={onClose}>
              {t('feedback.done')}
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4 px-5 py-5"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSubmit();
            }}
          >
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-text-muted">
                {t('feedback.messageLabel')}
              </span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE))}
                placeholder={t('feedback.placeholder')}
                rows={5}
                className="resize-y rounded-card border border-border bg-surface px-3 py-2 text-body text-text placeholder:text-text-muted focus:border-brand focus:outline-none"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-text-muted">
                {t('feedback.contactLabel')}
              </span>
              <input
                type="text"
                value={contact}
                onChange={(e) => setContact(e.target.value.slice(0, MAX_CONTACT))}
                placeholder={t('feedback.contactPlaceholder')}
                className="rounded-card border border-border bg-surface px-3 py-2 text-body text-text placeholder:text-text-muted focus:border-brand focus:outline-none"
              />
            </label>

            {error ? (
              <p className="text-caption text-error" role="alert">
                {error}
              </p>
            ) : null}

            <Button type="submit" variant="primary" disabled={!canSend}>
              {phase === 'sending' ? t('feedback.sending') : t('feedback.send')}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
