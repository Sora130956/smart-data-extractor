import { create } from 'zustand';
import type { PresetId, ResultFilter, SchemaField } from '@/types/extraction';

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'sde.theme';

function readInitialTheme(): Theme {
  // index.html already resolved this before first paint; mirror it here.
  const attr = document.documentElement.dataset.theme;
  return attr === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

interface UiState {
  theme: Theme;
  preset: PresetId;
  instructions: string;
  filter: ResultFilter;
  /** Effective field set shown/edited in the SchemaEditor for the current preset. */
  customFields: SchemaField[];
  /** True once the user has edited a preset's fields; drives the custom-schema submit path. */
  isSchemaModified: boolean;
  toggleTheme: () => void;
  setPreset: (preset: PresetId) => void;
  setInstructions: (instructions: string) => void;
  setFilter: (filter: ResultFilter) => void;
  setCustomFields: (fields: SchemaField[]) => void;
  resetToPreset: (fields: SchemaField[]) => void;
}

export const useUiStore = create<UiState>((set) => ({
  theme: readInitialTheme(),
  preset: 'invoice',
  instructions: '',
  filter: 'all',
  customFields: [],
  isSchemaModified: false,

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
}));
