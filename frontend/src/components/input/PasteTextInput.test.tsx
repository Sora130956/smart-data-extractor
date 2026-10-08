import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { parsePdf } from '@/api/client';
import { PasteTextInput, type StagedText } from './PasteTextInput';

vi.mock('@/api/client', () => ({
  parsePdf: vi.fn(),
}));

function makeFile(name: string, content: string, type = 'text/plain'): File {
  const file = new File([content], name, { type });
  // jsdom's File does not implement .text() yet.
  if (typeof file.text !== 'function') {
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) });
  }
  return file;
}

describe('PasteTextInput', () => {
  it('shows the empty hint when there are no staged texts', () => {
    render(<PasteTextInput staged={[]} onAdd={vi.fn()} onRemove={vi.fn()} />);

    expect(screen.getByText(/No text sources yet/)).toBeInTheDocument();
  });

  it('calls onAdd with the file name and its content when a txt file is selected', async () => {
    const onAdd = vi.fn();
    const { container } = render(<PasteTextInput staged={[]} onAdd={onAdd} onRemove={vi.fn()} />);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeFile('invoice.txt', 'Invoice #123');
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('invoice.txt', 'Invoice #123'));
  });

  it('calls onAdd for each selected txt file', async () => {
    const onAdd = vi.fn();
    const { container } = render(<PasteTextInput staged={[]} onAdd={onAdd} onRemove={vi.fn()} />);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const fileA = makeFile('a.txt', 'Content A');
    const fileB = makeFile('b.txt', 'Content B');
    fireEvent.change(input, { target: { files: [fileA, fileB] } });

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(2));
    expect(onAdd).toHaveBeenCalledWith('a.txt', 'Content A');
    expect(onAdd).toHaveBeenCalledWith('b.txt', 'Content B');
  });

  it('ignores non-txt files', async () => {
    const onAdd = vi.fn();
    const { container } = render(<PasteTextInput staged={[]} onAdd={onAdd} onRemove={vi.fn()} />);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeFile('image.png', 'binary');
    fireEvent.change(input, { target: { files: [file] } });

    await Promise.resolve();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('renders each staged item with its file name and character count', () => {
    const staged: StagedText[] = [
      { id: 'a', name: 'invoice.txt', text: 'First source text' },
      { id: 'b', name: 'contact.txt', text: 'Second source text' },
    ];
    render(<PasteTextInput staged={staged} onAdd={vi.fn()} onRemove={vi.fn()} />);

    expect(screen.queryByText(/No text sources yet/)).not.toBeInTheDocument();
    expect(screen.getByText('Text 1')).toBeInTheDocument();
    expect(screen.getByText('invoice.txt')).toBeInTheDocument();
    expect(screen.getByText('17 chars')).toBeInTheDocument();
    expect(screen.getByText('Text 2')).toBeInTheDocument();
    expect(screen.getByText('contact.txt')).toBeInTheDocument();
    expect(screen.getByText('18 chars')).toBeInTheDocument();
  });

  it('calls onRemove with the item id when its remove button is clicked', () => {
    const onRemove = vi.fn();
    const staged: StagedText[] = [{ id: 'a', name: 'invoice.txt', text: 'First source text' }];
    render(<PasteTextInput staged={staged} onAdd={vi.fn()} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Text 1' }));

    expect(onRemove).toHaveBeenCalledWith('a');
  });

  it('calls parsePdf and onAdd with the extracted text when a pdf file is selected', async () => {
    vi.mocked(parsePdf).mockResolvedValue({
      text: 'OCR extracted text',
      pages_failed: [],
      tokens_used: { input: 10, output: 5 },
      cost_usd: 0,
      cost_cny: 0,
    });
    const onAdd = vi.fn();
    const { container } = render(<PasteTextInput staged={[]} onAdd={onAdd} onRemove={vi.fn()} />);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeFile('scan.pdf', 'ignored', 'application/pdf');
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('scan.pdf', 'OCR extracted text'));
    expect(parsePdf).toHaveBeenCalledWith(file);
  });

  it('shows an error and does not call onAdd when pdf parsing fails', async () => {
    vi.mocked(parsePdf).mockRejectedValue(new Error('File must be a PDF'));
    const onAdd = vi.fn();
    const { container } = render(<PasteTextInput staged={[]} onAdd={onAdd} onRemove={vi.fn()} />);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeFile('scan.pdf', 'ignored', 'application/pdf');
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText('File must be a PDF')).toBeInTheDocument());
    expect(onAdd).not.toHaveBeenCalled();
  });
});
