// History store (DESIGN.md §10 Q1): v1 persists completed extraction batches
// to localStorage — newest first, capped, reloaded on boot. Hand-rolled
// persistence mirrors uiStore's `sde.*` convention; no login/backend involved.

import { create } from 'zustand';
import type { ExtractionSource } from '@/types/extraction';
import { applyFieldEdit } from '@/utils/review';

export const HISTORY_STORAGE_KEY = 'sde.history';
export const HISTORY_LIMIT = 20;

export interface HistoryEntry {
  id: string;
  /** ISO timestamp of when the batch completed. */
  savedAt: string;
  /** Preset display name (or "Custom Schema") snapshotted at submit time. */
  presetLabel: string;
  sources: ExtractionSource[];
}

/** Read persisted entries; corrupted or missing data starts empty. */
export function readHistoryEntries(): HistoryEntry[] {
  const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function persist(entries: HistoryEntry[]) {
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries));
}

interface HistoryState {
  entries: HistoryEntry[];
  addEntry: (sources: ExtractionSource[], presetLabel: string) => void;
  removeEntry: (id: string) => void;
  clear: () => void;
  updateResultField: (sourceId: string, fieldKey: string, newValue: unknown) => void;
}

export const useHistoryStore = create<HistoryState>((set) => ({
  entries: readHistoryEntries(),

  addEntry: (sources, presetLabel) =>
    set((state) => {
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        savedAt: new Date().toISOString(),
        presetLabel,
        // Issue #4: blob URLs are session-scoped — after a reload they are
        // dead and would render a broken file preview. The full sourceText
        // (also snapshotted on the source) keeps the text preview working
        // for restored batches; the live on-screen sources keep their URL.
        sources: sources.map(({ sourceFileUrl: _dropped, ...rest }) => rest),
      };
      const entries = [entry, ...state.entries].slice(0, HISTORY_LIMIT);
      persist(entries);
      return { entries };
    }),

  removeEntry: (id) =>
    set((state) => {
      const entries = state.entries.filter((e) => e.id !== id);
      persist(entries);
      return { entries };
    }),

  clear: () => {
    persist([]);
    set({ entries: [] });
  },

  updateResultField: (sourceId, fieldKey, newValue) =>
    set((state) => {
      const entries = state.entries.map((entry) => ({
        ...entry,
        sources: entry.sources.map((source) => {
          if (source.id !== sourceId) return source;
          return {
            ...source,
            results: source.results.map((result) =>
              applyFieldEdit(result, fieldKey, newValue),
            ),
          };
        }),
      }));
      persist(entries);
      return { entries };
    }),
}));
