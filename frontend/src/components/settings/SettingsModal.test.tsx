import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { useUiStore } from '@/store/uiStore';
import { SettingsModal } from './SettingsModal';

function renderModal(open = true) {
  const onClose = vi.fn();
  render(<SettingsModal open={open} onClose={onClose} />);
  return { onClose };
}

describe('SettingsModal', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ pdfSplitMode: 'whole' });
  });

  it('renders the parsing group with both split modes', () => {
    renderModal();

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('Document Parsing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Whole document' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Per page' })).toBeInTheDocument();
  });

  it('marks the active split mode as pressed', () => {
    useUiStore.setState({ pdfSplitMode: 'pages' });
    renderModal();

    expect(screen.getByRole('button', { name: 'Per page' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Whole document' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('switches pdfSplitMode and persists when a mode is selected', () => {
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'Per page' }));

    expect(useUiStore.getState().pdfSplitMode).toBe('pages');
    expect(localStorage.getItem('sde.pdfSplitMode')).toBe('pages');
  });

  it('closes on Escape', () => {
    const { onClose } = renderModal();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes via the close button', () => {
    const { onClose } = renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when closed', () => {
    renderModal(false);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
