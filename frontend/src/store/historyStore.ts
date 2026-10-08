// History store (DESIGN.md §10 Q1): v1 persists completed extraction batches
// to localStorage — newest first, capped, reloaded on boot. Hand-rolled
// persistence mirrors uiStore's `sde.*` convention; no login/backend involved.

import { create } from 'zustand';
import type { ExtractionSource } from '@/types/extraction';

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
}

export const useHistoryStore = create<HistoryState>((set) => ({
  entries: readHistoryEntries(),

  addEntry: (sources, presetLabel) =>
    set((state) => {
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        savedAt: new Date().toISOString(),
        presetLabel,
        sources,
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
}));
