import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { ResultDetailModal } from './ResultDetailModal';
import { exportToExcel } from '@/utils/excelExport';
import type { ExtractionResult, ExtractionSource } from '@/types/extraction';

vi.mock('@/utils/excelExport', () => ({ exportToExcel: vi.fn() }));

const source: ExtractionSource = {
  id: 'text-0',
  type: 'text',
  name: 'Manual Input 1',
  uploadedAt: '2024-03-14T00:00:00.000Z',
  meta: 'Invoice INV-2024-001 dated 2024-03-14 for Acme Corp…',
  fieldLabels: { invoice_number: 'Invoice Number', vendor: 'Vendor', notes: 'Notes' },
  results: [],
  stats: {
    succeeded: 1, failed: 0, totalCostUsd: 0.0002, totalCostCny: 0.00145, avgConfidence: 0.9,
    schemaResolveCostUsd: 0, schemaResolveCostCny: 0,
  },
};

const highConfidenceResult: ExtractionResult = {
  sourceId: 'text-0',
  index: '1',
  status: 'success',
  data: { invoice_number: 'INV-2024-001', vendor: 'Acme Corp', notes: null },
  confidence: { invoice_number: 0.95, vendor: 0.9, notes: 0.9 },
  avgConfidence: 0.92,
  tokensUsed: { input: 100, output: 20 },
  costUsd: 0.0002, costCny: 0.00145,
};

const lowConfidenceResult: ExtractionResult = {
  ...highConfidenceResult,
  data: { invoice_number: 'INV-2024-001', vendor: 'Acme Corp', notes: null },
  confidence: { invoice_number: 0.5, vendor: 0.9, notes: 0.9 },
  avgConfidence: 0.6,
};

describe('ResultDetailModal', () => {
  afterEach(async () => {
    await i18next.changeLanguage('en');
  });

  it('renders the title with the given label and the source name/meta', () => {
    render(
      <ResultDetailModal source={source} result={highConfidenceResult} label="Text 1" onClose={() => {}} />,
    );

    expect(screen.getByText(/Text 1/)).toBeInTheDocument();
    expect(screen.getByText(/Manual Input 1/)).toBeInTheDocument();
  });

  it('renders each field with its display label, value, and confidence score', () => {
    render(
      <ResultDetailModal source={source} result={highConfidenceResult} label="Text 1" onClose={() => {}} />,
    );

    expect(screen.getByText('Invoice Number')).toBeInTheDocument();
    expect(screen.getByText('INV-2024-001')).toBeInTheDocument();
    expect(screen.getByText('0.95')).toBeInTheDocument();
    expect(screen.getByText('null')).toBeInTheDocument();
  });

  it('shows the needs-review warning only when a field is below the low-confidence threshold', () => {
    const { rerender } = render(
      <ResultDetailModal source={source} result={highConfidenceResult} label="Text 1" onClose={() => {}} />,
    );
    expect(screen.queryByText(/Needs review/)).not.toBeInTheDocument();

    rerender(
      <ResultDetailModal source={source} result={lowConfidenceResult} label="Text 1" onClose={() => {}} />,
    );
    expect(screen.getByText(/Needs review/)).toBeInTheDocument();
  });

  it('calls onClose when pressing Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ResultDetailModal source={source} result={highConfidenceResult} label="Text 1" onClose={onClose} />,
    );

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when clicking either Close button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ResultDetailModal source={source} result={highConfidenceResult} label="Text 1" onClose={onClose} />,
    );

    const closeButtons = screen.getAllByRole('button', { name: 'Close' });
    expect(closeButtons).toHaveLength(2);

    await user.click(closeButtons[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when clicking inside the dialog body', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ResultDetailModal source={source} result={highConfidenceResult} label="Text 1" onClose={onClose} />,
    );

    await user.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('disables the "Retry This Item" action', () => {
    render(
      <ResultDetailModal source={source} result={highConfidenceResult} label="Text 1" onClose={() => {}} />,
    );

    expect(screen.getByRole('button', { name: 'Retry This Item' })).toBeDisabled();
  });

  describe('Copy JSON', () => {
    const originalClipboard = navigator.clipboard;

    afterEach(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: originalClipboard,
        configurable: true,
        writable: true,
      });
    });

    it('copies the result JSON to the clipboard and shows a confirmation', async () => {
      // userEvent.setup() injects its own read-only clipboard stub, so the
      // mock must be installed *after* setup() to avoid being overwritten.
      const user = userEvent.setup();
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
        writable: true,
      });

      render(
        <ResultDetailModal source={source} result={highConfidenceResult} label="Text 1" onClose={() => {}} />,
      );

      await user.click(screen.getByRole('button', { name: 'Copy JSON' }));

      expect(writeText).toHaveBeenCalledWith(JSON.stringify(highConfidenceResult, null, 2));
      expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    });
  });

  describe('Export JSON', () => {
    beforeEach(() => {
      URL.createObjectURL = vi.fn(() => 'blob:mock-url');
      URL.revokeObjectURL = vi.fn();
    });

    it('triggers a JSON file download named after the source and label', async () => {
      const user = userEvent.setup();
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      render(
        <ResultDetailModal source={source} result={highConfidenceResult} label="Text 1" onClose={() => {}} />,
      );

      await user.click(screen.getByRole('button', { name: 'Export JSON' }));

      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

      clickSpy.mockRestore();
    });
  });

  describe('Export Excel', () => {
    it('exports only the displayed result to a file named after the source and label', async () => {
      const user = userEvent.setup();
      render(
        <ResultDetailModal source={source} result={highConfidenceResult} label="Text 1" onClose={() => {}} />,
      );

      await user.click(screen.getByRole('button', { name: 'Export Excel' }));

      expect(exportToExcel).toHaveBeenCalledWith(
        [expect.objectContaining({ name: 'Manual Input 1', results: [highConfidenceResult] })],
        'Manual Input 1-Text 1.xlsx',
        expect.any(Function),
      );
    });
  });

  it('fires onClose only once per Escape keypress', () => {
    const onClose = vi.fn();
    render(
      <ResultDetailModal source={source} result={highConfidenceResult} label="Text 1" onClose={onClose} />,
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
