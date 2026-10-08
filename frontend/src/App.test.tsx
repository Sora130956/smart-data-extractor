import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import App from './App';
import { LANGUAGE_STORAGE_KEY } from '@/i18n';
import { THEME_STORAGE_KEY, useUiStore } from '@/store/uiStore';

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

describe('F3 result detail modal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useUiStore.setState({ preset: 'invoice', instructions: '', customFields: [], isSchemaModified: false });
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
