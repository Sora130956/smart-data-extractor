import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
          description_zh: '联系人全名',
          description_en: 'Full name of the contact person',
        },
        {
          field_name: 'email',
          display_name_zh: '邮箱',
          display_name_en: 'Email',
          type: 'string',
          format: null,
          description_zh: null,
          description_en: 'Email address of the contact',
        },
      ],
    }),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('SchemaEditor', () => {
  beforeEach(() => {
    // The store defaults to "smart"; these tests exercise a backend preset.
    useUiStore.setState({ preset: 'invoice' });
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
    vi.unstubAllGlobals();
    localStorage.clear();
    useUiStore.setState({
      preset: 'invoice',
      customFields: [],
      isSchemaModified: false,
      savedSchemas: [],
      presetOverrides: {},
    });
  });

  it('loads the preset schema and renders one row per field', async () => {
    stubPresetSchemaFetch();
    render(<SchemaEditor />, { wrapper });

    await waitFor(() => expect(screen.getAllByLabelText('Field Name')).toHaveLength(2));
    expect(screen.getByDisplayValue('Name')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Email')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Full name of the contact person')).toBeInTheDocument();
    // description_zh missing -> falls back to the English column.
    expect(screen.getByDisplayValue('Email address of the contact')).toBeInTheDocument();
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
    // Descriptions localize too: zh column first, English fallback.
    expect(screen.getByDisplayValue('联系人全名')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Email address of the contact')).toBeInTheDocument();
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

  it('seeds from a saved override instead of the backend preset schema', async () => {
    stubPresetSchemaFetch();
    useUiStore.setState({
      presetOverrides: {
        invoice: [
          { displayName: 'Overridden', fieldName: 'name', type: 'string', description: 'Mine' },
        ],
      },
    });
    render(<SchemaEditor />, { wrapper });

    await waitFor(() => expect(screen.getByDisplayValue('Overridden')).toBeInTheDocument());
    expect(screen.queryByDisplayValue('Name')).not.toBeInTheDocument();
    // Reset stays enabled: an override exists even though nothing is modified.
    expect(screen.getByRole('button', { name: 'Reset to Preset' })).toBeEnabled();
  });

  it('saves preset edits as a persisted override', async () => {
    stubPresetSchemaFetch();
    render(<SchemaEditor />, { wrapper });

    await waitFor(() => expect(screen.getAllByLabelText('Field Name')).toHaveLength(2));
    const edited = [
      { displayName: 'Edited', fieldName: 'name', type: 'string' as const, description: '' },
    ];
    useUiStore.getState().setCustomFields(edited);
    await waitFor(() => expect(screen.getByText('Modified')).toBeInTheDocument());

    screen.getByRole('button', { name: 'Save' }).click();

    await waitFor(() => expect(screen.queryByText('Modified')).not.toBeInTheDocument());
    expect(useUiStore.getState().presetOverrides.invoice).toEqual(edited);
    const persisted = JSON.parse(localStorage.getItem('sde.presetOverrides') ?? '{}');
    expect(persisted.invoice).toEqual(edited);
  });

  it('clears the override and restores the backend fields on reset', async () => {
    stubPresetSchemaFetch();
    render(<SchemaEditor />, { wrapper });

    await waitFor(() => expect(screen.getByDisplayValue('Name')).toBeInTheDocument());
    useUiStore
      .getState()
      .setCustomFields([{ displayName: 'Edited', fieldName: 'name', type: 'string', description: '' }]);
    await waitFor(() => expect(screen.getByText('Modified')).toBeInTheDocument());
    screen.getByRole('button', { name: 'Save' }).click();
    await waitFor(() => expect(useUiStore.getState().presetOverrides.invoice).toBeDefined());

    screen.getByRole('button', { name: 'Reset to Preset' }).click();

    await waitFor(() =>
      expect(useUiStore.getState().presetOverrides.invoice).toBeUndefined(),
    );
    await waitFor(() => expect(screen.getByDisplayValue('Name')).toBeInTheDocument());
    expect(localStorage.getItem('sde.presetOverrides')).toBe('{}');
  });

  it('hides Reset to Preset for saved schemas but keeps Save', async () => {
    const fields = [
      { displayName: 'Custom', fieldName: 'x', type: 'string' as const, description: '' },
    ];
    useUiStore.setState({
      preset: 'saved-1',
      savedSchemas: [
        { id: 'saved-1', name: 'My Schema', fields, createdAt: '2026-01-01T00:00:00Z' },
      ],
      customFields: fields,
      isSchemaModified: true,
    });
    render(<SchemaEditor />, { wrapper });

    expect(screen.getByDisplayValue('Custom')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset to Preset' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();

    screen.getByRole('button', { name: 'Save' }).click();

    await waitFor(() => expect(screen.queryByText('Modified')).not.toBeInTheDocument());
    expect(useUiStore.getState().savedSchemas[0].fields).toEqual(fields);
  });

  describe('min confidence column (issue #2 — preset tiers)', () => {
    it('renders one tier select per field, defaulting to the Default tier', async () => {
      stubPresetSchemaFetch();
      render(<SchemaEditor />, { wrapper });

      await waitFor(() => expect(screen.getAllByLabelText('Field Name')).toHaveLength(2));
      const selects = screen.getAllByLabelText('Min Confidence');
      expect(selects).toHaveLength(2);
      for (const select of selects) {
        expect(select).toHaveValue('');
        expect(select).toHaveDisplayValue('Default (0.70)');
      }
    });

    it('offers the four preset tiers in the user-stated order', async () => {
      stubPresetSchemaFetch();
      render(<SchemaEditor />, { wrapper });

      await waitFor(() => expect(screen.getAllByLabelText('Min Confidence')).toHaveLength(2));
      const select = screen.getAllByLabelText('Min Confidence')[0];
      expect(
        Array.from(select.querySelectorAll('option')).map((o) => o.textContent),
      ).toEqual(['Strict (0.9)', 'Moderate (0.8)', 'Default (0.70)', 'Lenient (0.5)']);
    });

    it('stores the picked tier on that field and marks the schema modified', async () => {
      const user = userEvent.setup();
      stubPresetSchemaFetch();
      render(<SchemaEditor />, { wrapper });

      await waitFor(() => expect(screen.getAllByLabelText('Min Confidence')).toHaveLength(2));
      await user.selectOptions(screen.getAllByLabelText('Min Confidence')[0], '0.9');

      expect(useUiStore.getState().customFields[0].minConfidence).toBe(0.9);
      expect(useUiStore.getState().customFields[1].minConfidence).toBeUndefined();
      expect(screen.getByText('Modified')).toBeInTheDocument();
    });

    it('picking the Default tier stores null (fall back to the global default)', async () => {
      const user = userEvent.setup();
      stubPresetSchemaFetch();
      render(<SchemaEditor />, { wrapper });

      await waitFor(() => expect(screen.getAllByLabelText('Min Confidence')).toHaveLength(2));
      const select = screen.getAllByLabelText('Min Confidence')[0];
      await user.selectOptions(select, '0.9');
      await user.selectOptions(select, '');

      expect(useUiStore.getState().customFields[0].minConfidence).toBeNull();
    });

    it('keeps a legacy free-input value visible until a tier is picked', async () => {
      const user = userEvent.setup();
      stubPresetSchemaFetch();
      render(<SchemaEditor />, { wrapper });

      await waitFor(() => expect(screen.getAllByLabelText('Min Confidence')).toHaveLength(2));
      useUiStore.setState({
        customFields: useUiStore.getState().customFields.map((f, i) =>
          i === 0 ? { ...f, minConfidence: 0.85 } : f,
        ),
      });

      const select = screen.getAllByLabelText('Min Confidence')[0];
      await waitFor(() => {
        expect(select).toHaveValue('0.85');
        expect(select).toHaveDisplayValue('0.85');
      });

      await user.selectOptions(select, '0.9');
      expect(useUiStore.getState().customFields[0].minConfidence).toBe(0.9);
    });
  });

  describe('allow empty column (issue #2)', () => {
    it('renders one two-option select per field, defaulting to Not allowed', async () => {
      stubPresetSchemaFetch();
      render(<SchemaEditor />, { wrapper });

      await waitFor(() => expect(screen.getAllByLabelText('Field Name')).toHaveLength(2));
      const selects = screen.getAllByLabelText('Allow Empty');
      expect(selects).toHaveLength(2);
      for (const select of selects) {
        expect(select).toHaveValue('');
        expect(select).toHaveDisplayValue('Not allowed');
      }
    });

    it('stores true when Allowed is picked and marks the schema modified', async () => {
      const user = userEvent.setup();
      stubPresetSchemaFetch();
      render(<SchemaEditor />, { wrapper });

      await waitFor(() => expect(screen.getAllByLabelText('Allow Empty')).toHaveLength(2));
      await user.selectOptions(screen.getAllByLabelText('Allow Empty')[0], 'true');

      expect(useUiStore.getState().customFields[0].allowEmpty).toBe(true);
      expect(useUiStore.getState().customFields[1].allowEmpty).toBeUndefined();
      expect(screen.getByText('Modified')).toBeInTheDocument();
    });

    it('stores false when switching back to Not allowed', async () => {
      const user = userEvent.setup();
      stubPresetSchemaFetch();
      render(<SchemaEditor />, { wrapper });

      await waitFor(() => expect(screen.getAllByLabelText('Allow Empty')).toHaveLength(2));
      const select = screen.getAllByLabelText('Allow Empty')[0];
      await user.selectOptions(select, 'true');
      await user.selectOptions(select, '');

      expect(useUiStore.getState().customFields[0].allowEmpty).toBe(false);
    });
  });
});
