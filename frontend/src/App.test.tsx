import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import App from './App';
import { LANGUAGE_STORAGE_KEY } from '@/i18n';
import { THEME_STORAGE_KEY, useUiStore } from '@/store/uiStore';
import { HISTORY_STORAGE_KEY, useHistoryStore } from '@/store/historyStore';

function renderApp() {
  return render(<App />);
}

function makeFile(name: string, content: string): File {
  const file = new File([content], name, { type: 'text/plain' });
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
      expect(screen.getByRole('option', { name: 'Invoice' })).toBeInTheDocument(),
    );

    const input = () => container.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input(), { target: { files: [makeFile('first.txt', 'First staged text')] } });
    await waitFor(() => expect(screen.getByText('first.txt')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Start Extraction' }));
    await waitFor(() => expect(screen.getByText(/First staged text/)).toBeInTheDocument());

    fireEvent.change(input(), { target: { files: [makeFile('second.txt', 'Second staged text')] } });
    await waitFor(() => expect(screen.getByText('second.txt')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Start Extraction' }));
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
      expect(screen.getByRole('option', { name: 'Invoice' })).toBeInTheDocument(),
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeFile('invoice.txt', 'Invoice #123 from Acme Corp');
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText('invoice.txt')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Start Extraction' }));
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
      expect(screen.getByRole('option', { name: 'Invoice' })).toBeInTheDocument(),
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeFile('invoice.txt', 'Invoice #123 from Acme Corp');
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText('invoice.txt')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Start Extraction' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Extraction Result — Text 1/)).toBeInTheDocument();

    const closeButtons = screen.getAllByRole('button', { name: 'Close' });
    await user.click(closeButtons[0]);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
