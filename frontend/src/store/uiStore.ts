import { create } from 'zustand';
import type { ResultFilter, SavedSchema, SchemaField } from '@/types/extraction';

export type Theme = 'light' | 'dark';
export type PdfSplitMode = 'whole' | 'pages';

export const THEME_STORAGE_KEY = 'sde.theme';
export const PDF_SPLIT_STORAGE_KEY = 'sde.pdfSplitMode';
export const SAVED_SCHEMAS_STORAGE_KEY = 'sde.savedSchemas';
/** Fixed preset id for the "infer schema from text" flow (not a real backend preset). */
export const SMART_PRESET_ID = 'smart';

function readInitialTheme(): Theme {
  // index.html already resolved this before first paint; mirror it here.
  const attr = document.documentElement.dataset.theme;
  return attr === 'dark' ? 'dark' : 'light';
}

export function readInitialPdfSplitMode(): PdfSplitMode {
  const stored = localStorage.getItem(PDF_SPLIT_STORAGE_KEY);
  return stored === 'pages' ? 'pages' : 'whole';
}

export function readInitialSavedSchemas(): SavedSchema[] {
  const stored = localStorage.getItem(SAVED_SCHEMAS_STORAGE_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as SavedSchema[]) : [];
  } catch {
    return [];
  }
}

function persistSavedSchemas(schemas: SavedSchema[]) {
  localStorage.setItem(SAVED_SCHEMAS_STORAGE_KEY, JSON.stringify(schemas));
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

interface UiState {
  theme: Theme;
  preset: string;
  instructions: string;
  filter: ResultFilter;
  /** Effective field set shown/edited in the SchemaEditor for the current preset. */
  customFields: SchemaField[];
  /** True once the user has edited a preset's fields; drives the custom-schema submit path. */
  isSchemaModified: boolean;
  /** How an uploaded PDF becomes text sources: one merged source or one per page. */
  pdfSplitMode: PdfSplitMode;
  /** Schemas the user saved locally (e.g. from the "smart" inference flow). */
  savedSchemas: SavedSchema[];
  toggleTheme: () => void;
  setPreset: (preset: string) => void;
  setInstructions: (instructions: string) => void;
  setFilter: (filter: ResultFilter) => void;
  setCustomFields: (fields: SchemaField[]) => void;
  resetToPreset: (fields: SchemaField[]) => void;
  setPdfSplitMode: (mode: PdfSplitMode) => void;
  addSavedSchema: (name: string, fields: SchemaField[]) => string;
  renameSavedSchema: (id: string, name: string) => void;
  deleteSavedSchema: (id: string) => void;
  updateSavedSchema: (id: string, fields: SchemaField[]) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: readInitialTheme(),
  preset: 'invoice',
  instructions: '',
  filter: 'all',
  customFields: [],
  isSchemaModified: false,
  pdfSplitMode: readInitialPdfSplitMode(),
  savedSchemas: readInitialSavedSchemas(),

  toggleTheme: () =>
    set((state) => {
      const theme: Theme = state.theme === 'dark' ? 'light' : 'dark';
      applyTheme(theme);
      return { theme };
    }),

  setPreset: (preset) => set({ preset, customFields: [], isSchemaModified: false }),
  setInstructions: (instructions) => set({ instructions }),
  setFilter: (filter) => set({ filter }),
  // Editing a field implicitly switches the submit path to custom schema (D-F06).
  setCustomFields: (fields) => set({ customFields: fields, isSchemaModified: true }),
  resetToPreset: (fields) => set({ customFields: fields, isSchemaModified: false }),
  setPdfSplitMode: (mode) => {
    localStorage.setItem(PDF_SPLIT_STORAGE_KEY, mode);
    set({ pdfSplitMode: mode });
  },
  addSavedSchema: (name, fields) => {
    const id = crypto.randomUUID();
    const entry: SavedSchema = { id, name, fields, createdAt: new Date().toISOString() };
    const savedSchemas = [...get().savedSchemas, entry];
    persistSavedSchemas(savedSchemas);
    set({ savedSchemas });
    return id;
  },
  renameSavedSchema: (id, name) => {
    const savedSchemas = get().savedSchemas.map((s) => (s.id === id ? { ...s, name } : s));
    persistSavedSchemas(savedSchemas);
    set({ savedSchemas });
  },
  deleteSavedSchema: (id) => {
    const savedSchemas = get().savedSchemas.filter((s) => s.id !== id);
    persistSavedSchemas(savedSchemas);
    set({ savedSchemas });
  },
  updateSavedSchema: (id, fields) => {
    const savedSchemas = get().savedSchemas.map((s) => (s.id === id ? { ...s, fields } : s));
    persistSavedSchemas(savedSchemas);
    set({ savedSchemas });
  },
}));
