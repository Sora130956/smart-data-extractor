import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import '@/i18n';
import { ConfigBar } from './ConfigBar';
import { useUiStore } from '@/store/uiStore';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const PRESET_LIST = [
  { id: 'contact', display_name_zh: '联系人', display_name_en: 'Contact', is_builtin: true },
  { id: 'invoice', display_name_zh: '发票', display_name_en: 'Invoice', is_builtin: true },
];

function stubPresetsFetch() {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url === '/api/presets') {
      return Promise.resolve({ ok: true, json: async () => PRESET_LIST });
    }
    return Promise.resolve({ ok: true, json: async () => ({ fields: [] }) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ConfigBar', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useUiStore.setState({
      preset: 'invoice',
      instructions: '',
      customFields: [],
      isSchemaModified: false,
    });
  });

  it('renders one option per preset from the API', async () => {
    stubPresetsFetch();
    render(<ConfigBar />, { wrapper });

    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Preset: Invoice' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('option', { name: 'Preset: Contact' })).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeEnabled();
  });

  it('disables the preset select while presets are loading', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    render(<ConfigBar />, { wrapper });

    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Loading presets…' })).toBeInTheDocument();
  });

  it('shows an error and disables the select when presets fail to load', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    render(<ConfigBar />, { wrapper });

    await waitFor(() => expect(screen.getByText('Failed to load presets')).toBeInTheDocument());
    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});
