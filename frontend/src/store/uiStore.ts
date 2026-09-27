import { create } from 'zustand';
import type { ExtractionMode, PresetId, ResultFilter } from '@/types/extraction';

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
  mode: ExtractionMode;
  preset: PresetId;
  instructions: string;
  filter: ResultFilter;
  toggleTheme: () => void;
  setMode: (mode: ExtractionMode) => void;
  setPreset: (preset: PresetId) => void;
  setInstructions: (instructions: string) => void;
  setFilter: (filter: ResultFilter) => void;
}

export const useUiStore = create<UiState>((set) => ({
  theme: readInitialTheme(),
  mode: 'preset',
  preset: 'invoice',
  instructions: '',
  filter: 'all',

  toggleTheme: () =>
    set((state) => {
      const theme: Theme = state.theme === 'dark' ? 'light' : 'dark';
      applyTheme(theme);
      return { theme };
    }),

  setMode: (mode) => set({ mode }),
  setPreset: (preset) => set({ preset }),
  setInstructions: (instructions) => set({ instructions }),
  setFilter: (filter) => set({ filter }),
}));
