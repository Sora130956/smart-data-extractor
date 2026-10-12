import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { useUiStore } from '@/store/uiStore';
import { DEFAULT_SHORTCUTS } from '@/utils/shortcuts';
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

  describe('shortcuts section (issue #5)', () => {
    const REBIND = {
      nextField: 'Rebind: Next review field',
      prevField: 'Rebind: Previous review field',
      saveNext: 'Rebind: Save & jump to next document',
      cancelEdit: 'Rebind: Cancel edit',
    };

    beforeEach(() => {
      localStorage.clear();
      useUiStore.setState({ shortcuts: { ...DEFAULT_SHORTCUTS } });
    });

    it('renders the four rows with the default combos', () => {
      renderModal();

      expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: REBIND.nextField })).toHaveTextContent('Tab');
      expect(screen.getByRole('button', { name: REBIND.prevField })).toHaveTextContent('Shift+Tab');
      expect(screen.getByRole('button', { name: REBIND.saveNext })).toHaveTextContent('Ctrl+S');
      expect(screen.getByRole('button', { name: REBIND.cancelEdit })).toHaveTextContent('Escape');
    });

    it('rebinds a shortcut by recording a new combo', () => {
      renderModal();

      fireEvent.click(screen.getByRole('button', { name: REBIND.nextField }));
      expect(screen.getByText('Press a new combo…')).toBeInTheDocument();
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'd', ctrlKey: true });

      expect(useUiStore.getState().shortcuts.nextField).toBe('Ctrl+D');
      expect(JSON.parse(localStorage.getItem('sde.shortcuts') ?? '{}')).toEqual({
        ...DEFAULT_SHORTCUTS,
        nextField: 'Ctrl+D',
      });
      expect(screen.getByRole('button', { name: REBIND.nextField })).toHaveTextContent('Ctrl+D');
    });

    it('rejects a conflicting combo with an error naming the other action, staying in recording', () => {
      renderModal();

      fireEvent.click(screen.getByRole('button', { name: REBIND.saveNext }));
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });

      expect(screen.getByText('Already used by "Next review field"')).toBeInTheDocument();
      expect(screen.getByText('Press a new combo…')).toBeInTheDocument();
      expect(useUiStore.getState().shortcuts.saveNext).toBe('Ctrl+S');
    });

    it('rejects browser-reserved combos the page cannot intercept', () => {
      renderModal();

      fireEvent.click(screen.getByRole('button', { name: REBIND.nextField }));
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'w', ctrlKey: true });

      expect(screen.getByText(/Reserved by the browser/)).toBeInTheDocument();
      expect(useUiStore.getState().shortcuts.nextField).toBe('Tab');
    });

    it('rejects bare printable keys that would collide with typing in the edit input', () => {
      renderModal();

      fireEvent.click(screen.getByRole('button', { name: REBIND.nextField }));
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'j' });

      expect(screen.getByText(/Not bindable/)).toBeInTheDocument();
      expect(useUiStore.getState().shortcuts.nextField).toBe('Tab');
    });

    it('aborting with Escape does not close the dialog', () => {
      const { onClose } = renderModal();

      fireEvent.click(screen.getByRole('button', { name: REBIND.nextField }));
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: REBIND.nextField })).toHaveTextContent('Tab');
    });

    it('ignores bare modifier presses while recording', () => {
      renderModal();

      fireEvent.click(screen.getByRole('button', { name: REBIND.nextField }));
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Control', ctrlKey: true });
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'd', ctrlKey: true });

      expect(useUiStore.getState().shortcuts.nextField).toBe('Ctrl+D');
    });

    it('reset restores and persists the defaults', () => {
      useUiStore.getState().setShortcut('nextField', 'Ctrl+D');
      renderModal();

      fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));

      expect(useUiStore.getState().shortcuts).toEqual({ ...DEFAULT_SHORTCUTS });
      expect(JSON.parse(localStorage.getItem('sde.shortcuts') ?? '{}')).toEqual({
        ...DEFAULT_SHORTCUTS,
      });
    });
  });
});
