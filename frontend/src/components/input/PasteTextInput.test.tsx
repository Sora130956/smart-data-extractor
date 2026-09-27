import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { PasteTextInput, type StagedText } from './PasteTextInput';

describe('PasteTextInput', () => {
  it('disables Add until the textarea has non-whitespace content', () => {
    render(<PasteTextInput staged={[]} onAdd={vi.fn()} onRemove={vi.fn()} />);

    const addButton = screen.getByRole('button', { name: '+ Add as Source' });
    expect(addButton).toBeDisabled();

    const textarea = screen.getByPlaceholderText(/Paste one block of text here/);
    fireEvent.change(textarea, { target: { value: '   ' } });
    expect(addButton).toBeDisabled();

    fireEvent.change(textarea, { target: { value: 'Invoice #123' } });
    expect(addButton).not.toBeDisabled();
  });

  it('calls onAdd with the trimmed text and clears the textarea', () => {
    const onAdd = vi.fn();
    render(<PasteTextInput staged={[]} onAdd={onAdd} onRemove={vi.fn()} />);

    const textarea = screen.getByPlaceholderText<HTMLTextAreaElement>(
      /Paste one block of text here/,
    );
    fireEvent.change(textarea, { target: { value: '  Invoice #123  ' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add as Source' }));

    expect(onAdd).toHaveBeenCalledWith('Invoice #123');
    expect(textarea.value).toBe('');
  });

  it('updates the live character count as the draft changes', () => {
    render(<PasteTextInput staged={[]} onAdd={vi.fn()} onRemove={vi.fn()} />);

    const textarea = screen.getByPlaceholderText(/Paste one block of text here/);
    fireEvent.change(textarea, { target: { value: 'hello' } });

    expect(screen.getByText('5 characters')).toBeInTheDocument();
  });

  it('shows the empty hint when there are no staged texts', () => {
    render(<PasteTextInput staged={[]} onAdd={vi.fn()} onRemove={vi.fn()} />);

    expect(screen.getByText(/No text sources yet/)).toBeInTheDocument();
  });

  it('renders each staged item with its preview and character count', () => {
    const staged: StagedText[] = [
      { id: 'a', text: 'First source text' },
      { id: 'b', text: 'Second source text' },
    ];
    render(<PasteTextInput staged={staged} onAdd={vi.fn()} onRemove={vi.fn()} />);

    expect(screen.queryByText(/No text sources yet/)).not.toBeInTheDocument();
    expect(screen.getByText('Text 1')).toBeInTheDocument();
    expect(screen.getByText('First source text')).toBeInTheDocument();
    expect(screen.getByText('17 chars')).toBeInTheDocument();
    expect(screen.getByText('Text 2')).toBeInTheDocument();
    expect(screen.getByText('Second source text')).toBeInTheDocument();
    expect(screen.getByText('18 chars')).toBeInTheDocument();
  });

  it('calls onRemove with the item id when its remove button is clicked', () => {
    const onRemove = vi.fn();
    const staged: StagedText[] = [{ id: 'a', text: 'First source text' }];
    render(<PasteTextInput staged={staged} onAdd={vi.fn()} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Text 1' }));

    expect(onRemove).toHaveBeenCalledWith('a');
  });
});
