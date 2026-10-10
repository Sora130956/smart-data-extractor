import { render, screen, fireEvent, within } from '@testing-library/react';
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
  // Notes is the classic optional field: a null value must not flag the
  // batch for review (issue #2 allow-empty).
  allowEmptyFields: ['notes'],
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

  it('never flags an allowed-empty field whose value is null (issue #2 allow-empty)', () => {
    // notes is null but exempted on the source; everything else clears.
    render(
      <ResultDetailModal source={source} result={highConfidenceResult} label="Text 1" onClose={() => {}} />,
    );
    expect(screen.queryByText(/Needs review/)).not.toBeInTheDocument();
  });

  it('flags an empty field that is not allowed to be empty, naming it (issue #2 allow-empty)', () => {
    // Realistic backend shape: a null field's confidence is zeroed.
    const vendorNullResult: ExtractionResult = {
      ...highConfidenceResult,
      data: { invoice_number: 'INV-2024-001', vendor: null, notes: null },
      confidence: { invoice_number: 0.95, vendor: 0, notes: 0 },
      avgConfidence: 0.32,
    };
    render(
      <ResultDetailModal source={source} result={vendorNullResult} label="Text 1" onClose={() => {}} />,
    );

    // The empty violation gets its own warning segment; the threshold
    // segment stays hidden because no non-empty field is below 0.70.
    expect(screen.getByText(/must not be empty/)).toBeInTheDocument();
    expect(screen.getByText(/Vendor\)/)).toBeInTheDocument();
    expect(screen.queryByText(/below their min confidence/)).not.toBeInTheDocument();
  });

  it('still judges an allowed-empty field by its threshold when it has a value', () => {
    const notesLowResult: ExtractionResult = {
      ...highConfidenceResult,
      data: { invoice_number: 'INV-2024-001', vendor: 'Acme Corp', notes: 'Late delivery' },
      confidence: { invoice_number: 0.95, vendor: 0.9, notes: 0.5 },
      avgConfidence: 0.78,
    };
    render(
      <ResultDetailModal source={source} result={notesLowResult} label="Text 1" onClose={() => {}} />,
    );

    // The exemption only covers empty values: a non-empty value is still
    // judged against the 0.85 default minimum.
    expect(screen.getByText(/Notes \(0\.85\)/)).toBeInTheDocument();
  });

  it('explains an aggregate-only flag with the average-confidence warning (issue #3)', () => {
    // Every field clears its own (loose) threshold, but the average stays
    // below 0.70 — there is no single field to blame.
    const avgOnlyResult: ExtractionResult = {
      ...highConfidenceResult,
      data: { invoice_number: 'INV-2024-001', vendor: 'Acme Corp', notes: null },
      confidence: { invoice_number: 0.65, vendor: 0.65, notes: 0.65 },
      avgConfidence: 0.65,
    };
    render(
      <ResultDetailModal
        source={{
          ...source,
          reviewThresholds: { invoice_number: 0.5, vendor: 0.5, notes: 0.5 },
        }}
        result={avgOnlyResult}
        label="Text 1"
        onClose={() => {}}
      />,
    );

    expect(screen.getByText(/average confidence is below/)).toBeInTheDocument();
    // Not the vacuous "0 field(s)" line — no field is below its threshold.
    expect(screen.queryByText(/below their min confidence/)).not.toBeInTheDocument();
  });

  it('replaces the warning with an all-reviewed banner once every problem field is reviewed (issue #3)', () => {
    render(
      <ResultDetailModal
        source={source}
        result={{ ...lowConfidenceResult, reviewedFields: { invoice_number: true } }}
        label="Text 1"
        onClose={() => {}}
      />,
    );

    expect(screen.getByText(/All problem fields have been reviewed/)).toBeInTheDocument();
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

  describe('review pane (issue #4)', () => {
    const PANE_TEXT =
      'INVOICE\nInvoice No: INV-2024-001\nVendor: Acme Corp\nTotal Amount: $100.00\n';

    it('renders the full source text with matched values highlighted', () => {
      render(
        <ResultDetailModal
          source={{ ...source, sourceText: PANE_TEXT }}
          result={highConfidenceResult}
          label="Text 1"
          onClose={() => {}}
        />,
      );

      const pane = screen.getByRole('region', { name: 'Extracted Text' });
      // Both scalar values are located inside the pane's text.
      expect(within(pane).getByText('INV-2024-001')).toBeInTheDocument();
      expect(within(pane).getByText(/Acme Corp/)).toBeInTheDocument();
      // Values that pass their threshold get the neutral brand highlight.
      expect(within(pane).getByText('INV-2024-001').className).toContain('bg-brand');
    });

    it('colors a below-threshold field value with the warning highlight', () => {
      render(
        <ResultDetailModal
          source={{ ...source, sourceText: PANE_TEXT }}
          result={lowConfidenceResult}
          label="Text 1"
          onClose={() => {}}
        />,
      );

      const pane = screen.getByRole('region', { name: 'Extracted Text' });
      // invoice_number sits at 0.5 → needs review → warning highlight.
      expect(within(pane).getByText('INV-2024-001').className).toContain('bg-warning');
      // vendor at 0.9 stays neutral.
      expect(within(pane).getByText(/Acme Corp/).className).not.toContain('bg-warning');
    });

    it('defaults to the file view for uploads and embeds the original inline', () => {
      render(
        <ResultDetailModal
          source={{ ...source, type: 'pdf', sourceFileUrl: 'blob:pdf', sourceText: PANE_TEXT }}
          result={highConfidenceResult}
          label="Text 1"
          onClose={() => {}}
        />,
      );

      const filePane = screen.getByRole('region', { name: 'Original File' });
      const frame = within(filePane).getByTitle('Manual Input 1');
      expect(frame).toHaveAttribute('src', 'blob:pdf');
      // The text pane is one toggle away.
      expect(screen.queryByRole('region', { name: 'Extracted Text' })).not.toBeInTheDocument();
    });

    it('embeds images directly instead of a pdf frame', () => {
      render(
        <ResultDetailModal
          source={{ ...source, type: 'image', sourceFileUrl: 'blob:img', sourceText: PANE_TEXT }}
          result={highConfidenceResult}
          label="Text 1"
          onClose={() => {}}
        />,
      );

      const filePane = screen.getByRole('region', { name: 'Original File' });
      expect(within(filePane).getByRole('img', { name: 'Manual Input 1' })).toHaveAttribute(
        'src',
        'blob:img',
      );
    });

    it('switches to the text view when a locate button is clicked, scrolling to the match', async () => {
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;
      try {
        const user = userEvent.setup();
        render(
          <ResultDetailModal
            source={{ ...source, type: 'pdf', sourceFileUrl: 'blob:pdf', sourceText: PANE_TEXT }}
            result={lowConfidenceResult}
            label="Text 1"
            onClose={() => {}}
          />,
        );

        // Starts on the file view.
        expect(screen.getByRole('region', { name: 'Original File' })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Locate Invoice Number in source' }));

        // Auto-switched to the text view and scrolled the match into view.
        const pane = screen.getByRole('region', { name: 'Extracted Text' });
        expect(scrollIntoView).toHaveBeenCalledTimes(1);
        // The located match flashes (active styling on the same node).
        expect(within(pane).getByText('INV-2024-001').className).toContain('animate-pulse');
      } finally {
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      }
    });

    it('offers no locate button when the value has no match or no source text exists', () => {
      const unmatchedResult: ExtractionResult = {
        ...highConfidenceResult,
        data: { invoice_number: 'NOPE-999', vendor: 'Ghost Ltd', notes: null },
        confidence: { invoice_number: 0.95, vendor: 0.9, notes: 0.9 },
      };
      const { rerender } = render(
        <ResultDetailModal
          source={{ ...source, sourceText: PANE_TEXT }}
          result={unmatchedResult}
          label="Text 1"
          onClose={() => {}}
        />,
      );

      expect(screen.queryByRole('button', { name: /Locate/ })).not.toBeInTheDocument();

      // No sourceText at all (e.g. legacy history): still nothing to locate.
      rerender(
        <ResultDetailModal source={source} result={highConfidenceResult} label="Text 1" onClose={() => {}} />,
      );
      expect(screen.queryByRole('button', { name: /Locate/ })).not.toBeInTheDocument();
    });

    it('shows an empty state when there is neither a file url nor source text', () => {
      render(<ResultDetailModal source={source} result={highConfidenceResult} label="Text 1" onClose={() => {}} />);

      expect(screen.getByText('No source preview available')).toBeInTheDocument();
    });
  });

  describe('grounding boxes from OCR blocks (D-028)', () => {
    const PANE_TEXT =
      'INVOICE\nInvoice No: INV-2024-001\nVendor: Acme Corp\nTotal Amount: $100.00\n';

    function makeFileSource(overrides: Partial<ExtractionSource> = {}): ExtractionSource {
      return {
        ...source,
        type: 'image',
        sourceFileUrl: 'blob:img',
        sourceText: PANE_TEXT,
        // One page of OCR grounding blocks: block text is matched against
        // the extracted values verbatim (after normalization).
        pagesBlocks: [
          [
            { text: 'INVOICE', box: [5, 5, 30, 10] },
            { text: 'INV-2024-001', box: [40, 12, 70, 18] },
            { text: 'Acme Corp', box: [40, 20, 70, 26] },
          ],
        ],
        ...overrides,
      };
    }

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('matches field boxes locally from the persisted grounding blocks on open, with no network call', () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      render(
        <ResultDetailModal
          source={makeFileSource()}
          result={highConfidenceResult}
          label="Text 1"
          onClose={() => {}}
        />,
      );

      // Both matched fields offer the locate button; nothing is fetched —
      // the boxes come from the parse-time grounding, not a second call.
      expect(
        screen.getByRole('button', { name: 'Locate Invoice Number in source' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Locate Vendor in source' })).toBeInTheDocument();
      // notes is null and unmatched values expose no button.
      expect(screen.queryByRole('button', { name: /Locate Notes/ })).not.toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not match when the source has no grounding blocks (text-only / legacy data)', () => {
      render(
        <ResultDetailModal
          source={makeFileSource({ sourceText: undefined, pagesBlocks: undefined })}
          result={highConfidenceResult}
          label="Text 1"
          onClose={() => {}}
        />,
      );

      // No text to highlight and no blocks to match: no locate buttons.
      expect(screen.queryByRole('button', { name: /Locate/ })).not.toBeInTheDocument();
    });

    it('ignores blocks whose text only contains the value (exact block match only)', () => {
      render(
        <ResultDetailModal
          source={makeFileSource({
            sourceText: undefined,
            pagesBlocks: [[{ text: 'Invoice No: INV-2024-001', box: [10, 20, 30, 40] }]],
          })}
          result={highConfidenceResult}
          label="Text 1"
          onClose={() => {}}
        />,
      );

      // The block text must equal the extracted value after normalization —
      // a surrounding label is not a match (mirrors the backend semantics).
      expect(screen.queryByRole('button', { name: /Locate/ })).not.toBeInTheDocument();
    });

    it('folds whitespace, case, and fullwidth characters when matching', () => {
      render(
        <ResultDetailModal
          source={makeFileSource({
            sourceText: undefined,
            pagesBlocks: [[{ text: '  inv-2024-001  ', box: [10, 20, 30, 40] }]],
          })}
          result={highConfidenceResult}
          label="Text 1"
          onClose={() => {}}
        />,
      );

      expect(
        screen.getByRole('button', { name: 'Locate Invoice Number in source' }),
      ).toBeInTheDocument();
    });

    it('offers the locate button for grounded fields even without a text match', () => {
      render(
        <ResultDetailModal
          source={makeFileSource({ sourceText: undefined })}
          result={highConfidenceResult}
          label="Text 1"
          onClose={() => {}}
        />,
      );

      expect(
        screen.getByRole('button', { name: 'Locate Invoice Number in source' }),
      ).toBeInTheDocument();
    });

    it('clicking locate overlays the box on the file preview instead of the text view', async () => {
      const user = userEvent.setup();
      render(
        <ResultDetailModal
          source={makeFileSource({ pageImages: ['aGk='] })}
          result={highConfidenceResult}
          label="Text 1"
          onClose={() => {}}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Locate Invoice Number in source' }));

      const filePane = screen.getByRole('region', { name: 'Original File' });
      const overlay = filePane.querySelector('[data-field="invoice_number"]');
      expect(overlay).not.toBeNull();
      expect(overlay?.className).toContain('animate-pulse');
      // The text view stays hidden — the box on the image is the target.
      expect(screen.queryByRole('region', { name: 'Extracted Text' })).not.toBeInTheDocument();
    });
  });
});
