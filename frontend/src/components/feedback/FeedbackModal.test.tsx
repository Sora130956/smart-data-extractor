import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { FeedbackModal } from './FeedbackModal';
import { ApiError, sendFeedback } from '@/api/client';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, sendFeedback: vi.fn() };
});

describe('FeedbackModal', () => {
  beforeEach(() => {
    vi.mocked(sendFeedback).mockReset();
  });

  it('renders the form and keeps Send disabled until the message is non-blank', async () => {
    const user = userEvent.setup();
    render(<FeedbackModal open onClose={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Feedback' })).toBeInTheDocument();
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();

    // Whitespace alone must not enable Send.
    await user.type(screen.getByRole('textbox', { name: 'Message' }), '   ');
    expect(send).toBeDisabled();

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'x');
    expect(send).toBeEnabled();
  });

  it('sends the trimmed message with optional contact, then shows the sent state', async () => {
    vi.mocked(sendFeedback).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<FeedbackModal open onClose={onClose} />);

    await user.type(screen.getByRole('textbox', { name: 'Message' }), '  Excel export fails  ');
    await user.type(
      screen.getByRole('textbox', { name: 'Contact (optional)' }),
      'user@example.com',
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(sendFeedback).toHaveBeenCalledWith('Excel export fails', 'user@example.com');
    expect(screen.getByText(/thank you for your feedback/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('omits the contact field when left empty', async () => {
    vi.mocked(sendFeedback).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<FeedbackModal open onClose={vi.fn()} />);

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'love the tool');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(sendFeedback).toHaveBeenCalledWith('love the tool', undefined);
  });

  it('shows a localized error and keeps the form editable when the send fails', async () => {
    vi.mocked(sendFeedback).mockRejectedValue(
      new ApiError(
        'Failed to send the feedback email. Please try again later.',
        502,
        'feedback_send_failed',
      ),
    );
    const user = userEvent.setup();
    render(<FeedbackModal open onClose={vi.fn()} />);

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'help');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(screen.getByText('Failed to send. Please try again later.')).toBeInTheDocument();
    // The message survives the failed attempt so the user can retry.
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('help');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('closes on Escape and resets the form for the next visit', async () => {
    vi.mocked(sendFeedback).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(<FeedbackModal open onClose={onClose} />);

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'help');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    // Reopen: previous draft is gone.
    rerender(<FeedbackModal open={false} onClose={onClose} />);
    rerender(<FeedbackModal open onClose={onClose} />);
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
  });
});
