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
      savedSchemas: [],
    });
  });

  it('renders one option per preset from the API', async () => {
    stubPresetsFetch();
    render(<ConfigBar />, { wrapper });

    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Invoice' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('option', { name: 'Contact' })).toBeInTheDocument();
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

  it('renders the fixed "smart" option after the preset list', async () => {
    stubPresetsFetch();
    render(<ConfigBar />, { wrapper });

    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Smart Inference ✨' })).toBeInTheDocument(),
    );
  });

  it('renders saved schemas under a "My Templates" optgroup', async () => {
    stubPresetsFetch();
    useUiStore.setState({
      savedSchemas: [
        { id: 'saved-1', name: 'My Saved Schema', fields: [], createdAt: '2026-01-01T00:00:00Z' },
      ],
    });
    render(<ConfigBar />, { wrapper });

    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'My Saved Schema' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('group', { name: 'My Templates' })).toBeInTheDocument();
  });

  it('does not render the optgroup when there are no saved schemas', async () => {
    stubPresetsFetch();
    render(<ConfigBar />, { wrapper });

    await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled());
    expect(screen.queryByRole('group', { name: 'My Templates' })).not.toBeInTheDocument();
  });

  it('loads the saved schema fields into customFields when selected', async () => {
    stubPresetsFetch();
    const fields = [
      {
        displayName: 'Name',
        fieldName: 'name',
        type: 'string' as const,
        description: 'The name',
      },
    ];
    useUiStore.setState({
      savedSchemas: [{ id: 'saved-1', name: 'My Saved Schema', fields, createdAt: '2026-01-01T00:00:00Z' }],
    });
    render(<ConfigBar />, { wrapper });

    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'My Saved Schema' })).toBeInTheDocument(),
    );
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'saved-1' } });

    expect(useUiStore.getState().preset).toBe('saved-1');
    expect(useUiStore.getState().customFields).toEqual(fields);
  });

  it('opens the manage schemas panel when the manage button is clicked', async () => {
    stubPresetsFetch();
    render(<ConfigBar />, { wrapper });

    await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled());
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
