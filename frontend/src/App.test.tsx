import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import i18n from '@/i18n';
import App from './App';
import { LANGUAGE_STORAGE_KEY } from '@/i18n';
import { THEME_STORAGE_KEY, useUiStore } from '@/store/uiStore';
import { HISTORY_STORAGE_KEY, useHistoryStore } from '@/store/historyStore';

function renderApp() {
  // The store defaults to "smart"; these tests exercise the invoice preset.
  useUiStore.setState({ preset: 'invoice' });
  return render(<App />);
}

function makeFile(name: string, content: string, type = 'text/plain'): File {
  const file = new File([content], name, { type });
  // jsdom's File does not implement .text() yet.
  if (typeof file.text !== 'function') {
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) });
  }
  return file;
}

const PRESET_LIST = [
  { id: 'invoice', display_name_zh: '发票', display_name_en: 'Invoice', is_builtin: true },
];

function stubExtractionFetch() {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url === '/api/presets') {
      return Promise.resolve({ ok: true, json: async () => PRESET_LIST });
    }
    if (typeof url === 'string' && url.startsWith('/api/presets/')) {
      return Promise.resolve({ ok: true, json: async () => ({ fields: [] }) });
    }
    if (url === '/api/batch_extract') {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          results: [
            {
              data: { vendor: 'Acme Corp', vendor_confidence: 0.92 },
              tokens_used: { input: 120, output: 30 },
              cost_usd: 0.0002,
              cost_cny: 0.00145,
              error: null,
            },
          ],
          total_cost_usd: 0.0002,
          total_cost_cny: 0.00145,
          total_tokens: { input: 120, output: 30 },
          succeeded: 1,
          failed: 0,
        }),
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('F1 shell', () => {
  it('renders the guidance empty state instead of an empty table (§8.8)', () => {
    renderApp();
    expect(screen.getByText('No extractions yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('switches language and persists the choice (§8.7)', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: '中文' }));

    expect(screen.getByText('还没有提取结果')).toBeInTheDocument();
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('zh');

    await user.click(screen.getByRole('button', { name: 'EN' }));
    expect(screen.getByText('No extractions yet')).toBeInTheDocument();
  });

  it('toggles the theme onto the document root and persists it', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: /theme/i }));

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('disables export while there are no results', () => {
    renderApp();
    expect(screen.getByRole('button', { name: /Export All JSON/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Export Excel/ })).toBeDisabled();
  });
});

function batchExtractPayload(vendor: string) {
  return {
    results: [
      {
        data: { vendor, vendor_confidence: 0.92 },
        tokens_used: { input: 120, output: 30 },
        cost_usd: 0.0002,
        cost_cny: 0.00145,
        error: null,
      },
    ],
    total_cost_usd: 0.0002,
    total_cost_cny: 0.00145,
    total_tokens: { input: 120, output: 30 },
    succeeded: 1,
    failed: 0,
  };
}

describe('F2 batch accumulation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useUiStore.setState({ preset: 'invoice', instructions: '', customFields: [], isSchemaModified: false });
    // Extractions now record history; reset that side effect between suites.
    localStorage.clear();
    useHistoryStore.setState({ entries: [] });
  });

  it('keeps previous results and puts the newest batch first when extracting again', async () => {
    const vendors = ['Acme Corp', 'Beta Ltd'];
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/presets') {
        return Promise.resolve({ ok: true, json: async () => PRESET_LIST });
      }
      if (typeof url === 'string' && url.startsWith('/api/presets/')) {
        return Promise.resolve({ ok: true, json: async () => ({ fields: [] }) });
      }
      if (url === '/api/batch_extract') {
        return Promise.resolve({
          ok: true,
          json: async () => batchExtractPayload(vendors.shift() ?? 'Gamma Inc'),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    const { container } = renderApp();

    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Preset: Invoice' })).toBeInTheDocument(),
    );

    const input = () => container.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input(), { target: { files: [makeFile('first.txt', 'First staged text')] } });
    await waitFor(() => expect(screen.getByText('first.txt')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Start Extraction 🚀' }));
    await waitFor(() => expect(screen.getByText(/First staged text/)).toBeInTheDocument());

    fireEvent.change(input(), { target: { files: [makeFile('second.txt', 'Second staged text')] } });
    await waitFor(() => expect(screen.getByText('second.txt')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Start Extraction 🚀' }));
    await waitFor(() => expect(screen.getByText(/Second staged text/)).toBeInTheDocument());

    // Old batch must survive the second extraction.
    expect(screen.getByText(/First staged text/)).toBeInTheDocument();
    // And the newest batch must render before the older one.
    const betaGroup = screen.getByText(/Second staged text/).closest('.border.rounded-card');
    const acmeGroup = screen.getByText(/First staged text/).closest('.border.rounded-card');
    expect(betaGroup).not.toBeNull();
    expect(acmeGroup).not.toBeNull();
    expect(
      (betaGroup as HTMLElement).compareDocumentPosition(acmeGroup as HTMLElement) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

describe('F5 smart inference template name', () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    // i18n is a module singleton; the zh-flow test must not leak its language.
    await i18n.changeLanguage('en');
    useUiStore.setState({
      preset: 'invoice',
      instructions: '',
      customFields: [],
      isSchemaModified: false,
      savedSchemas: [],
    });
    localStorage.clear();
    useHistoryStore.setState({ entries: [] });
  });

  it('saves the inferred schema under the AI-generated name, not a timestamp', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/presets') {
        return Promise.resolve({ ok: true, json: async () => PRESET_LIST });
      }
      if (url === '/api/schema/infer') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            schema: {
              fields: {
                invoice_number: {
                  type: 'string',
                  description: '发票的代码编号',
                  description_en: 'The invoice number',
                  required: true,
                  display_name: '发票号',
                  display_name_en: 'Invoice Number',
                },
              },
            },
            schema_name: '发票信息',
            schema_name_en: 'Invoice Info',
            tokens_used: { input: 20, output: 5 },
            cost_usd: 0.002,
            cost_cny: 0.0145,
          }),
        });
      }
      if (url === '/api/batch_extract') {
        return Promise.resolve({ ok: true, json: async () => batchExtractPayload('Acme Corp') });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    const { container } = renderApp();

    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Preset: Invoice' })).toBeInTheDocument(),
    );

    await user.selectOptions(screen.getByRole('combobox'), 'smart');

    const input = () => container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input(), { target: { files: [makeFile('invoice.txt', 'Invoice #123')] } });
    await waitFor(() => expect(screen.getByText('invoice.txt')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Start Extraction 🚀' }));

    // EN UI: the AI's English name becomes the saved template's dropdown label.
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Invoice Info' })).toBeInTheDocument(),
    );

    // EN UI: the inferred field label in the schema editor follows the UI
    // language (display_name_en), not the input text's language.
    expect(
      (screen.getAllByRole('textbox', { name: 'Field Name' })[0] as HTMLInputElement).value,
    ).toBe('Invoice Number');
    // Same for the field description (description_en).
    expect(
      (screen.getAllByRole('textbox', { name: 'Description' })[0] as HTMLInputElement).value,
    ).toBe('The invoice number');

    // End-to-end: the batch JSON export is named after the AI template name.
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = vi.fn();
    const downloads: string[] = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloads.push(this.download);
      });
    await user.click(screen.getByRole('button', { name: 'Export All JSON' }));
    expect(downloads[0]).toMatch(/^Invoice Info-\d{8}-\d{6}\.json$/);
    clickSpy.mockRestore();

    const stored = JSON.parse(
      localStorage.getItem('sde.savedSchemas') ?? '[]',
    ) as Array<{ name: string; nameEn: string }>;
    expect(stored).toHaveLength(1);
    // Both language names persist so the dropdown can follow later switches.
    expect(stored[0].name).toBe('发票信息');
    expect(stored[0].nameEn).toBe('Invoice Info');
  });

  it('labels inferred fields and the template name in Chinese under the zh UI', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/presets') {
        return Promise.resolve({ ok: true, json: async () => PRESET_LIST });
      }
      if (url === '/api/schema/infer') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            schema: {
              fields: {
                invoice_number: {
                  type: 'string',
                  description: '发票的代码编号',
                  description_en: 'The invoice number',
                  required: true,
                  display_name: '发票号',
                  display_name_en: 'Invoice Number',
                },
              },
            },
            schema_name: '发票信息',
            schema_name_en: 'Invoice Info',
            tokens_used: { input: 20, output: 5 },
            cost_usd: 0.002,
            cost_cny: 0.0145,
          }),
        });
      }
      if (url === '/api/batch_extract') {
        return Promise.resolve({ ok: true, json: async () => batchExtractPayload('Acme Corp') });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    const { container } = renderApp();

    // i18n is a module singleton; switch language via the header toggle.
    await user.click(screen.getByRole('button', { name: '中文' }));
    await waitFor(() =>
      expect(screen.getByRole('option', { name: '预设：发票' })).toBeInTheDocument(),
    );

    await user.selectOptions(screen.getByRole('combobox'), 'smart');

    const input = () => container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input(), { target: { files: [makeFile('invoice.txt', 'Invoice #123')] } });
    await waitFor(() => expect(screen.getByText('invoice.txt')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '开始提取 🚀' }));

    // ZH UI: the template dropdown shows the AI's Chinese name.
    await waitFor(() =>
      expect(screen.getByRole('option', { name: '发票信息' })).toBeInTheDocument(),
    );

    // ZH UI: inferred field label comes from display_name.
    expect(
      (screen.getAllByRole('textbox', { name: '字段名' })[0] as HTMLInputElement).value,
    ).toBe('发票号');
    // ZH UI: the description keeps the text-language column.
    expect(
      (screen.getAllByRole('textbox', { name: '描述' })[0] as HTMLInputElement).value,
    ).toBe('发票的代码编号');

    const stored = JSON.parse(
      localStorage.getItem('sde.savedSchemas') ?? '[]',
    ) as Array<{ name: string; nameEn: string }>;
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('发票信息');
    expect(stored[0].nameEn).toBe('Invoice Info');
  });
});

describe('F6 history integration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useUiStore.setState({ preset: 'invoice', instructions: '', customFields: [], isSchemaModified: false });
    localStorage.clear();
    useHistoryStore.setState({ entries: [] });
  });

  it('records a completed batch and restores it from history to the top of the list', async () => {
    stubExtractionFetch();
    const user = userEvent.setup();
    const { container } = renderApp();

    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Preset: Invoice' })).toBeInTheDocument(),
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeFile('invoice.txt', 'Invoice #123 from Acme Corp');
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText('invoice.txt')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Start Extraction 🚀' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument());

    // The completed batch was recorded into localStorage-backed history.
    const stored = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) ?? '[]') as Array<{
      presetLabel: string;
    }>;
    expect(stored).toHaveLength(1);
    expect(stored[0].presetLabel).toBe('Invoice');

    // History opens from the header; restoring prepends a fresh copy of the batch.
    await user.click(screen.getByRole('button', { name: 'History' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Invoice/ }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getAllByText(/Invoice #123 from Acme Corp/)).toHaveLength(2);
  });
});

describe('F3 result detail modal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useUiStore.setState({ preset: 'invoice', instructions: '', customFields: [], isSchemaModified: false });
    localStorage.clear();
    useHistoryStore.setState({ entries: [] });
  });

  it('opens the detail modal when clicking View on a result row and closes it', async () => {
    stubExtractionFetch();
    const user = userEvent.setup();
    const { container } = renderApp();

    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Preset: Invoice' })).toBeInTheDocument(),
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeFile('invoice.txt', 'Invoice #123 from Acme Corp');
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText('invoice.txt')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Start Extraction 🚀' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Extraction Result — Text 1/)).toBeInTheDocument();

    const closeButtons = screen.getAllByRole('button', { name: 'Close' });
    await user.click(closeButtons[0]);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('F7 original file url', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useUiStore.setState({ preset: 'invoice', instructions: '', customFields: [], isSchemaModified: false });
    localStorage.clear();
    useHistoryStore.setState({ entries: [] });
  });

  it('keeps the uploaded pdf blob url on the extracted source', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/presets') {
        return Promise.resolve({ ok: true, json: async () => PRESET_LIST });
      }
      if (typeof url === 'string' && url.startsWith('/api/presets/')) {
        return Promise.resolve({ ok: true, json: async () => ({ fields: [] }) });
      }
      if (url === '/api/parse_pdf') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            text: 'OCR extracted text',
            pages: ['OCR extracted text'],
            pages_failed: [],
            tokens_used: { input: 10, output: 5 },
            cost_usd: 0,
            cost_cny: 0,
          }),
        });
      }
      if (url === '/api/batch_extract') {
        return Promise.resolve({ ok: true, json: async () => batchExtractPayload('Acme Corp') });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');

    const user = userEvent.setup();
    const { container } = renderApp();

    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Preset: Invoice' })).toBeInTheDocument(),
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [makeFile('scan.pdf', 'ignored', 'application/pdf')] },
    });

    await waitFor(() => expect(screen.getByText('scan.pdf')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Start Extraction 🚀' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument());

    // The staged pdf's blob url survives into the extracted (and persisted) source.
    const stored = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) ?? '[]') as Array<{
      sources: Array<{ sourceFileUrl?: string }>;
    }>;
    expect(stored[0].sources[0].sourceFileUrl).toBe('blob:mock-url');
  });
});

describe('F8 field review editing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useUiStore.setState({ preset: 'invoice', instructions: '', customFields: [], isSchemaModified: false });
    localStorage.clear();
    useHistoryStore.setState({ entries: [] });
  });

  it('edits a field from the detail modal, marks it reviewed, and persists the correction', async () => {
    stubExtractionFetch();
    const user = userEvent.setup();
    const { container } = renderApp();

    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Preset: Invoice' })).toBeInTheDocument(),
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [makeFile('invoice.txt', 'Invoice #123 from Acme Corp')] },
    });
    await waitFor(() => expect(screen.getByText('invoice.txt')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Start Extraction 🚀' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'View' }));

    // Inline edit: correct the vendor, save with Enter.
    await user.click(screen.getByRole('button', { name: 'Edit vendor' }));
    const editInput = screen.getByDisplayValue('Acme Corp');
    await user.clear(editInput);
    await user.type(editInput, 'Beta Ltd{Enter}');

    // The modal shows the corrected value, the Reviewed badge, and the
    // original extraction value preserved for comparison (issue #1).
    // Scoped to the dialog: the results header's Reviewed filter chip
    // (issue #3) carries the same visible text outside of it.
    expect(screen.getAllByText('Beta Ltd').length).toBeGreaterThan(0);
    expect(within(screen.getByRole('dialog')).getByText('Reviewed')).toBeInTheDocument();
    expect(screen.getByText('Original value')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();

    // The correction is persisted into the history entry with the reviewed
    // mark AND the original value snapshot.
    const stored = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) ?? '[]') as Array<{
      sources: Array<{
        results: Array<{
          data: Record<string, unknown>;
          reviewedFields?: Record<string, boolean>;
          originalData?: Record<string, unknown>;
        }>;
      }>;
    }>;
    expect(stored[0].sources[0].results[0].data.vendor).toBe('Beta Ltd');
    expect(stored[0].sources[0].results[0].reviewedFields?.vendor).toBe(true);
    expect(stored[0].sources[0].results[0].originalData?.vendor).toBe('Acme Corp');

    // The result list behind the modal reflects the correction too (rendered
    // as a "vendor: Beta Ltd" chip; the source's text preview still mentions
    // "Acme Corp" from the original upload, so scope the check to the chip).
    await user.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText(/vendor:\s*Beta Ltd/)).toBeInTheDocument();
    expect(screen.queryByText(/vendor:\s*Acme Corp/)).not.toBeInTheDocument();
  });
});

describe('issue #3 reviewed filter menu', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useUiStore.setState({
      preset: 'invoice',
      instructions: '',
      customFields: [],
      isSchemaModified: false,
      filter: 'all',
    });
    localStorage.clear();
    useHistoryStore.setState({ entries: [] });
  });

  it('moves an item from Need Review to Reviewed once its problem field is reviewed', async () => {
    // Single field at 0.6: below the 0.85 default tier -> the one problem field.
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/presets') {
        return Promise.resolve({ ok: true, json: async () => PRESET_LIST });
      }
      if (typeof url === 'string' && url.startsWith('/api/presets/')) {
        return Promise.resolve({ ok: true, json: async () => ({ fields: [] }) });
      }
      if (url === '/api/batch_extract') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            results: [
              {
                data: { vendor: 'Acme Corp', vendor_confidence: 0.6 },
                tokens_used: { input: 120, output: 30 },
                cost_usd: 0.0002,
                cost_cny: 0.00145,
                error: null,
              },
            ],
            total_cost_usd: 0.0002,
            total_cost_cny: 0.00145,
            total_tokens: { input: 120, output: 30 },
            succeeded: 1,
            failed: 0,
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    const { container } = renderApp();

    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Preset: Invoice' })).toBeInTheDocument(),
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [makeFile('invoice.txt', 'Invoice #123 from Acme Corp')] },
    });
    await waitFor(() => expect(screen.getByText('invoice.txt')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Start Extraction 🚀' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument());

    // Flagged item: Need Review (1), Reviewed bucket still empty.
    expect(screen.getByRole('button', { name: /Need Review/ })).toHaveTextContent('(1)');
    expect(screen.getByRole('button', { name: /Reviewed/ })).toHaveTextContent('(0)');

    // Review the flagged field via the detail modal.
    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('button', { name: 'Edit vendor' }));
    const editInput = screen.getByDisplayValue('Acme Corp');
    await user.clear(editInput);
    await user.type(editInput, 'Beta Ltd{Enter}');
    await user.click(screen.getAllByRole('button', { name: 'Close' })[0]);

    // Every problem field reviewed: the item moved buckets.
    expect(screen.getByRole('button', { name: /Need Review/ })).toHaveTextContent('(0)');
    expect(screen.getByRole('button', { name: /Reviewed/ })).toHaveTextContent('(1)');

    // The Reviewed chip shows the item...
    await user.click(screen.getByRole('button', { name: /Reviewed/ }));
    expect(screen.getByRole('button', { name: /Reviewed/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();

    // ...and the Need Review chip no longer does.
    await user.click(screen.getByRole('button', { name: /Need Review/ }));
    expect(screen.queryByRole('button', { name: 'View' })).not.toBeInTheDocument();
  });
});

describe('preset override submit path', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useUiStore.setState({
      preset: 'invoice',
      instructions: '',
      customFields: [],
      isSchemaModified: false,
      savedSchemas: [],
      presetOverrides: {},
    });
    localStorage.clear();
    useHistoryStore.setState({ entries: [] });
  });

  it('submits a preset with a saved override via /schema/resolve, not the preset id', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/presets') {
        return Promise.resolve({ ok: true, json: async () => PRESET_LIST });
      }
      if (url === '/api/schema/resolve') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            schema: {
              fields: {
                company: { type: 'string', description: 'The company', required: true },
              },
            },
            tokens_used: { input: 10, output: 5 },
            cost_usd: 0.0001,
            cost_cny: 0.0007,
          }),
        });
      }
      if (url === '/api/batch_extract') {
        bodies.push(JSON.parse(String(init?.body)));
        return Promise.resolve({ ok: true, json: async () => batchExtractPayload('Acme Corp') });
      }
      if (typeof url === 'string' && url.startsWith('/api/presets/')) {
        return Promise.resolve({ ok: true, json: async () => ({ fields: [] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    useUiStore.setState({
      presetOverrides: {
        invoice: [
          { displayName: 'Company', fieldName: 'company', type: 'string', description: 'The company' },
        ],
      },
    });

    const user = userEvent.setup();
    const { container } = renderApp();

    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Preset: Invoice' })).toBeInTheDocument(),
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [makeFile('invoice.txt', 'Invoice #123 from Acme Corp')] },
    });
    await waitFor(() => expect(screen.getByText('invoice.txt')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Start Extraction 🚀' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    // The saved override replaces the backend preset schema on submit.
    expect(bodies[0].schema).toBeDefined();
    expect(bodies[0].preset).toBeUndefined();
  });
});
