import { beforeEach, describe, expect, it } from 'vitest';
import type { SchemaField } from '@/types/extraction';
import {
  PDF_SPLIT_STORAGE_KEY,
  PRESET_OVERRIDES_STORAGE_KEY,
  readInitialPdfSplitMode,
  readInitialPresetOverrides,
  readInitialSavedSchemas,
  savedSchemaLabel,
  SAVED_SCHEMAS_STORAGE_KEY,
  useUiStore,
} from './uiStore';

describe('pdfSplitMode', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to whole when nothing is stored', () => {
    expect(readInitialPdfSplitMode()).toBe('whole');
  });

  it('reads the stored value', () => {
    localStorage.setItem(PDF_SPLIT_STORAGE_KEY, 'pages');
    expect(readInitialPdfSplitMode()).toBe('pages');
  });

  it('ignores unknown stored values', () => {
    localStorage.setItem(PDF_SPLIT_STORAGE_KEY, 'bogus');
    expect(readInitialPdfSplitMode()).toBe('whole');
  });

  it('setPdfSplitMode updates state and persists to localStorage', () => {
    useUiStore.getState().setPdfSplitMode('pages');

    expect(useUiStore.getState().pdfSplitMode).toBe('pages');
    expect(localStorage.getItem(PDF_SPLIT_STORAGE_KEY)).toBe('pages');
  });
});

describe('savedSchemas', () => {
  const fields: SchemaField[] = [
    { displayName: 'Name', fieldName: 'name', type: 'string', description: 'The name' },
  ];

  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ savedSchemas: [] });
  });

  it('defaults to an empty list when nothing is stored', () => {
    expect(readInitialSavedSchemas()).toEqual([]);
  });

  it('reads previously persisted schemas', () => {
    const stored = [{ id: 'a', name: 'A', fields: [], createdAt: '2026-01-01T00:00:00Z' }];
    localStorage.setItem(SAVED_SCHEMAS_STORAGE_KEY, JSON.stringify(stored));
    expect(readInitialSavedSchemas()).toEqual(stored);
  });

  it('falls back to an empty list on malformed JSON', () => {
    localStorage.setItem(SAVED_SCHEMAS_STORAGE_KEY, '{not valid json');
    expect(readInitialSavedSchemas()).toEqual([]);
  });

  it('falls back to an empty list when the stored value is not an array', () => {
    localStorage.setItem(SAVED_SCHEMAS_STORAGE_KEY, JSON.stringify({ foo: 'bar' }));
    expect(readInitialSavedSchemas()).toEqual([]);
  });

  it('addSavedSchema appends an entry with both language names, updates state, and persists it', () => {
    const id = useUiStore.getState().addSavedSchema('我的模板', 'My Schema', fields);

    const state = useUiStore.getState().savedSchemas;
    expect(state).toHaveLength(1);
    expect(state[0]).toMatchObject({ id, name: '我的模板', nameEn: 'My Schema', fields });
    expect(typeof state[0].createdAt).toBe('string');

    const persisted = JSON.parse(localStorage.getItem(SAVED_SCHEMAS_STORAGE_KEY) ?? '[]');
    expect(persisted).toEqual(state);
  });

  it('renameSavedSchema overrides the name in both languages and persists it', () => {
    const id = useUiStore.getState().addSavedSchema('Old Name', 'Old Name EN', fields);
    useUiStore.getState().renameSavedSchema(id, 'New Name');

    expect(useUiStore.getState().savedSchemas[0].name).toBe('New Name');
    expect(useUiStore.getState().savedSchemas[0].nameEn).toBe('New Name');
    const persisted = JSON.parse(localStorage.getItem(SAVED_SCHEMAS_STORAGE_KEY) ?? '[]');
    expect(persisted[0].name).toBe('New Name');
    expect(persisted[0].nameEn).toBe('New Name');
  });

  it('savedSchemaLabel picks the name by UI language with fallback', () => {
    expect(savedSchemaLabel({ id: 'a', name: '发票', nameEn: 'Invoice', fields: [], createdAt: 'x' }, true)).toBe('发票');
    expect(savedSchemaLabel({ id: 'a', name: '发票', nameEn: 'Invoice', fields: [], createdAt: 'x' }, false)).toBe('Invoice');
    // nameEn missing (legacy entries): fall back to the stored name.
    expect(savedSchemaLabel({ id: 'a', name: '发票', fields: [], createdAt: 'x' }, false)).toBe('发票');
  });

  it('deleteSavedSchema removes the entry and persists it', () => {
    const id = useUiStore.getState().addSavedSchema('To Delete', 'To Delete', fields);
    useUiStore.getState().deleteSavedSchema(id);

    expect(useUiStore.getState().savedSchemas).toEqual([]);
    const persisted = JSON.parse(localStorage.getItem(SAVED_SCHEMAS_STORAGE_KEY) ?? '[]');
    expect(persisted).toEqual([]);
  });

  it('updateSavedSchema replaces the fields and persists them', () => {
    const id = useUiStore.getState().addSavedSchema('My Schema', 'My Schema', fields);
    const newFields: SchemaField[] = [
      { displayName: 'Age', fieldName: 'age', type: 'number', description: 'The age' },
    ];
    useUiStore.getState().updateSavedSchema(id, newFields);

    expect(useUiStore.getState().savedSchemas[0].fields).toEqual(newFields);
    const persisted = JSON.parse(localStorage.getItem(SAVED_SCHEMAS_STORAGE_KEY) ?? '[]');
    expect(persisted[0].fields).toEqual(newFields);
  });
});

describe('presetOverrides', () => {
  const fields: SchemaField[] = [
    { displayName: 'Name', fieldName: 'name', type: 'string', description: 'The name' },
  ];

  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ presetOverrides: {}, isSchemaModified: false });
  });

  it('defaults to an empty object when nothing is stored', () => {
    expect(readInitialPresetOverrides()).toEqual({});
  });

  it('reads previously persisted overrides', () => {
    localStorage.setItem(PRESET_OVERRIDES_STORAGE_KEY, JSON.stringify({ invoice: fields }));
    expect(readInitialPresetOverrides()).toEqual({ invoice: fields });
  });

  it('falls back to an empty object on malformed JSON or non-object values', () => {
    localStorage.setItem(PRESET_OVERRIDES_STORAGE_KEY, '{not valid json');
    expect(readInitialPresetOverrides()).toEqual({});

    localStorage.setItem(PRESET_OVERRIDES_STORAGE_KEY, JSON.stringify(['a']));
    expect(readInitialPresetOverrides()).toEqual({});
  });

  it('savePresetOverride stores the fields, persists them, and clears the modified flag', () => {
    useUiStore.setState({ isSchemaModified: true });
    useUiStore.getState().savePresetOverride('invoice', fields);

    expect(useUiStore.getState().presetOverrides.invoice).toEqual(fields);
    expect(useUiStore.getState().isSchemaModified).toBe(false);
    const persisted = JSON.parse(localStorage.getItem(PRESET_OVERRIDES_STORAGE_KEY) ?? '{}');
    expect(persisted.invoice).toEqual(fields);
  });

  it('clearPresetOverride removes the entry and persists it', () => {
    useUiStore.getState().savePresetOverride('invoice', fields);
    useUiStore.getState().clearPresetOverride('invoice');

    expect(useUiStore.getState().presetOverrides).toEqual({});
    const persisted = JSON.parse(localStorage.getItem(PRESET_OVERRIDES_STORAGE_KEY) ?? '{}');
    expect(persisted).toEqual({});
  });
});
