import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import i18n from '@/i18n';
import { SchemaEditor } from './SchemaEditor';
import { useUiStore } from '@/store/uiStore';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function stubPresetSchemaFetch() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      fields: [
        {
          field_name: 'name',
          display_name_zh: '姓名',
          display_name_en: 'Name',
          type: 'string',
          format: null,
          description: 'Full name',
        },
        {
          field_name: 'email',
          display_name_zh: '邮箱',
          display_name_en: 'Email',
          type: 'string',
          format: null,
          description: null,
        },
      ],
    }),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('SchemaEditor', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
    vi.unstubAllGlobals();
    useUiStore.setState({ customFields: [], isSchemaModified: false, preset: 'invoice' });
  });

  it('loads the preset schema and renders one row per field', async () => {
    stubPresetSchemaFetch();
    render(<SchemaEditor />, { wrapper });

    await waitFor(() => expect(screen.getAllByLabelText('Field Name')).toHaveLength(2));
    expect(screen.getByDisplayValue('Name')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Email')).toBeInTheDocument();
  });

  it('marks the schema as modified after editing a field', async () => {
    stubPresetSchemaFetch();
    render(<SchemaEditor />, { wrapper });

    await waitFor(() => expect(screen.getAllByLabelText('Field Name')).toHaveLength(2));
    expect(screen.queryByText('Modified')).not.toBeInTheDocument();

    useUiStore.getState().setCustomFields(useUiStore.getState().customFields);

    await waitFor(() => expect(screen.getByText('Modified')).toBeInTheDocument());
  });

  it('resets to the preset schema when Reset to Preset is clicked', async () => {
    stubPresetSchemaFetch();
    render(<SchemaEditor />, { wrapper });

    await waitFor(() => expect(screen.getAllByLabelText('Field Name')).toHaveLength(2));
    useUiStore
      .getState()
      .setCustomFields([{ displayName: 'custom', fieldName: null, type: 'string', description: '' }]);

    await waitFor(() => expect(screen.getByText('Modified')).toBeInTheDocument());

    screen.getByRole('button', { name: 'Reset to Preset' }).click();

    await waitFor(() => expect(screen.queryByText('Modified')).not.toBeInTheDocument());
  });

  it('refreshes field display names when the UI language changes', async () => {
    stubPresetSchemaFetch();
    render(<SchemaEditor />, { wrapper });

    await waitFor(() => expect(screen.getByDisplayValue('Name')).toBeInTheDocument());

    await i18n.changeLanguage('zh');

    await waitFor(() => expect(screen.getByDisplayValue('姓名')).toBeInTheDocument());
    expect(screen.getByDisplayValue('邮箱')).toBeInTheDocument();
  });

  it('keeps user edits instead of reseeding when the language changes', async () => {
    stubPresetSchemaFetch();
    render(<SchemaEditor />, { wrapper });

    await waitFor(() => expect(screen.getByDisplayValue('Name')).toBeInTheDocument());
    useUiStore
      .getState()
      .setCustomFields([{ displayName: 'custom', fieldName: null, type: 'string', description: '' }]);
    await waitFor(() => expect(screen.getByText('Modified')).toBeInTheDocument());

    await i18n.changeLanguage('zh');

    await waitFor(() => expect(screen.getByText('已修改')).toBeInTheDocument());
    expect(screen.getByDisplayValue('custom')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('姓名')).not.toBeInTheDocument();
  });
});
