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
  presetLabel: 'Invoice',
  fieldLabels: {
    invoice_number: 'Invoice Number', vendor: 'Vendor', notes: 'Notes',
    total: 'Total', paid: 'Paid', line_items: 'Line Items',
  },
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

const editableResult: ExtractionResult = {
  ...highConfidenceResult,
  data: {
    invoice_number: 'INV-2024-001',
    vendor: 'Acme Corp',
    notes: null,
    total: 100,
    paid: true,
    line_items: [{ name: 'Widget', qty: 2 }],
  },
  confidence: { invoice_number: 0.95, vendor: 0.9, notes: 0.9, total: 0.88, paid: 0.99 },
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

  it("judges the warning against the source's per-field thresholds and names them (issue #2)", () => {
    // invoice_number sits at 0.95 — above the 0.70 default, but strictly
    // under a configured 0.99 threshold.
    const thresholdedSource = { ...source, reviewThresholds: { invoice_number: 0.99 } };
    const { rerender } = render(
      <ResultDetailModal
        source={thresholdedSource}
        result={highConfidenceResult}
        label="Text 1"
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/Needs review/)).toBeInTheDocument();
    // The warning names the field and the threshold it was judged against.
    expect(screen.getByText(/Invoice Number \(0\.99\)/)).toBeInTheDocument();

    // Same result without configured thresholds: everything clears 0.70.
    rerender(
      <ResultDetailModal source={source} result={highConfidenceResult} label="Text 1" onClose={() => {}} />,
    );
    expect(screen.queryByText(/Needs review/)).not.toBeInTheDocument();
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

    it('triggers a JSON file download named after the template and a timestamp', async () => {
      const user = userEvent.setup();
      const downloads: string[] = [];
      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(function (this: HTMLAnchorElement) {
          downloads.push(this.download);
        });
      render(
        <ResultDetailModal source={source} result={highConfidenceResult} label="Text 1" onClose={() => {}} />,
      );

      await user.click(screen.getByRole('button', { name: 'Export JSON' }));

      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(downloads[0]).toMatch(/^Invoice-\d{8}-\d{6}\.json$/);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

      clickSpy.mockRestore();
    });

    it('falls back to the source name when no template label was snapshotted', async () => {
      const user = userEvent.setup();
      const downloads: string[] = [];
      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(function (this: HTMLAnchorElement) {
          downloads.push(this.download);
        });
      render(
        <ResultDetailModal
          source={{ ...source, presetLabel: undefined }}
          result={highConfidenceResult}
          label="Text 1"
          onClose={() => {}}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Export JSON' }));

      expect(downloads[0]).toMatch(/^Manual Input 1-\d{8}-\d{6}\.json$/);

      clickSpy.mockRestore();
    });
  });

  describe('Export Excel', () => {
    it('exports only the displayed result to a file named after the template and a timestamp', async () => {
      const user = userEvent.setup();
      render(
        <ResultDetailModal source={source} result={highConfidenceResult} label="Text 1" onClose={() => {}} />,
      );

      await user.click(screen.getByRole('button', { name: 'Export Excel' }));

      expect(exportToExcel).toHaveBeenCalledWith(
        [expect.objectContaining({ name: 'Manual Input 1', results: [highConfidenceResult] })],
        expect.stringMatching(/^Invoice-\d{8}-\d{6}\.xlsx$/),
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

  describe('open original file', () => {
    it('shows a link pointing at the source file url in a new tab', () => {
      render(
        <ResultDetailModal
          source={{ ...source, sourceFileUrl: 'blob:mock-url' }}
          result={highConfidenceResult}
          label="Text 1"
          onClose={() => {}}
        />,
      );

      const link = screen.getByRole('link', { name: 'Open Original' });
      expect(link).toHaveAttribute('href', 'blob:mock-url');
      expect(link).toHaveAttribute('target', '_blank');
    });

    it('omits the link when the source has no file url', () => {
      render(
        <ResultDetailModal source={source} result={highConfidenceResult} label="Text 1" onClose={() => {}} />,
      );

      expect(screen.queryByRole('link', { name: 'Open Original' })).not.toBeInTheDocument();
    });
  });

  describe('field editing', () => {
    it('offers edit buttons for scalar fields but not for array fields', () => {
      render(
        <ResultDetailModal
          source={source}
          result={editableResult}
          label="Text 1"
          onClose={() => {}}
          onFieldUpdate={() => {}}
        />,
      );

      expect(screen.getByRole('button', { name: 'Edit Vendor' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Edit Total' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Edit Paid' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Edit Line Items' })).not.toBeInTheDocument();
    });

    it('hides edit buttons when no update callback is provided', () => {
      render(
        <ResultDetailModal source={source} result={editableResult} label="Text 1" onClose={() => {}} />,
      );

      expect(screen.queryByRole('button', { name: 'Edit Vendor' })).not.toBeInTheDocument();
    });

    it('edits a string field and reports the new value on Enter', async () => {
      const user = userEvent.setup();
      const onFieldUpdate = vi.fn();
      render(
        <ResultDetailModal
          source={source}
          result={editableResult}
          label="Text 1"
          onClose={() => {}}
          onFieldUpdate={onFieldUpdate}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Edit Vendor' }));
      const input = screen.getByDisplayValue('Acme Corp');
      await user.clear(input);
      await user.type(input, 'Beta Ltd{Enter}');

      expect(onFieldUpdate).toHaveBeenCalledWith('vendor', 'Beta Ltd');
    });

    it('keeps numbers numeric when saving an edited number field', async () => {
      const user = userEvent.setup();
      const onFieldUpdate = vi.fn();
      render(
        <ResultDetailModal
          source={source}
          result={editableResult}
          label="Text 1"
          onClose={() => {}}
          onFieldUpdate={onFieldUpdate}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Edit Total' }));
      const input = screen.getByDisplayValue('100');
      await user.clear(input);
      await user.type(input, '200.5{Enter}');

      expect(onFieldUpdate).toHaveBeenCalledWith('total', 200.5);
    });

    it('commits a boolean field through a checkbox toggle', async () => {
      const user = userEvent.setup();
      const onFieldUpdate = vi.fn();
      render(
        <ResultDetailModal
          source={source}
          result={editableResult}
          label="Text 1"
          onClose={() => {}}
          onFieldUpdate={onFieldUpdate}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Edit Paid' }));
      const checkbox = screen.getByRole('checkbox', { checked: true });
      await user.click(checkbox);

      expect(onFieldUpdate).toHaveBeenCalledWith('paid', false);
    });

    it('cancels editing with Escape without reporting and keeps the dialog open', async () => {
      const user = userEvent.setup();
      const onFieldUpdate = vi.fn();
      const onClose = vi.fn();
      render(
        <ResultDetailModal
          source={source}
          result={editableResult}
          label="Text 1"
          onClose={onClose}
          onFieldUpdate={onFieldUpdate}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Edit Vendor' }));
      await user.type(screen.getByDisplayValue('Acme Corp'), 'X{Escape}');

      expect(onFieldUpdate).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });
  });

  describe('reviewed badge', () => {
    it('replaces the confidence score with a Reviewed badge on reviewed fields', () => {
      render(
        <ResultDetailModal
          source={source}
          result={{ ...editableResult, reviewedFields: { invoice_number: true } }}
          label="Text 1"
          onClose={() => {}}
        />,
      );

      expect(screen.getByText('Reviewed')).toBeInTheDocument();
      expect(screen.queryByText('0.95')).not.toBeInTheDocument();
      // Unreviewed fields (vendor, notes) keep their numeric badges.
      expect(screen.getAllByText('0.90')).toHaveLength(2);
    });
  });

  describe('original value hint (issue #1)', () => {
    it('shows the pre-edit extraction value under a reviewed field', () => {
      render(
        <ResultDetailModal
          source={source}
          result={{
            ...editableResult,
            data: { ...editableResult.data, vendor: 'Beta Ltd' },
            originalData: { vendor: 'Acme Corp' },
            reviewedFields: { vendor: true },
          }}
          label="Text 1"
          onClose={() => {}}
          onFieldUpdate={() => {}}
        />,
      );

      expect(screen.getByText('Beta Ltd')).toBeInTheDocument();
      expect(screen.getByText('Original value')).toBeInTheDocument();
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    it('shows no hint when nothing was reviewed or no snapshot exists', () => {
      render(
        <ResultDetailModal
          source={source}
          result={{ ...editableResult, reviewedFields: { vendor: true } }}
          label="Text 1"
          onClose={() => {}}
        />,
      );

      expect(screen.queryByText('Original value')).not.toBeInTheDocument();
    });
  });
});
