// History store (DESIGN.md §10 Q1: v1 persists to localStorage): completed
// extraction batches are recorded newest-first, capped, and reloaded on boot.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  HISTORY_LIMIT,
  HISTORY_STORAGE_KEY,
  readHistoryEntries,
  useHistoryStore,
} from './historyStore';
import type { HistoryEntry } from './historyStore';
import type { ExtractionSource } from '@/types/extraction';

function makeSource(id: string): ExtractionSource {
  return {
    id,
    type: 'text',
    name: `Manual Input 1`,
    ordinal: 1,
    uploadedAt: '2026-10-08T00:00:00.000Z',
    meta: `preview for ${id}`,
    results: [
      {
        sourceId: id,
        index: '1',
        status: 'success',
        data: { vendor: 'Acme' },
        confidence: { vendor: 0.9 },
        avgConfidence: 0.9,
        tokensUsed: { input: 10, output: 5 },
        costUsd: 0.0001,
        costCny: 0.0007,
      },
    ],
    stats: {
      succeeded: 1,
      failed: 0,
      totalCostUsd: 0.0001,
      totalCostCny: 0.0007,
      avgConfidence: 0.9,
      schemaResolveCostUsd: 0,
      schemaResolveCostCny: 0,
    },
  };
}

function readStored(): HistoryEntry[] {
  return JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) ?? '[]') as HistoryEntry[];
}

describe('readHistoryEntries', () => {
  beforeEach(() => localStorage.clear());

  it('returns an empty list when the storage key is absent', () => {
    expect(readHistoryEntries()).toEqual([]);
  });

  it('returns parsed entries previously persisted', () => {
    const stored: HistoryEntry[] = [
      { id: 'e1', savedAt: '2026-10-08T01:00:00.000Z', presetLabel: 'Invoice', sources: [makeSource('s1')] },
    ];
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(stored));

    expect(readHistoryEntries()).toEqual(stored);
  });

  it('tolerates corrupted JSON by starting empty instead of throwing', () => {
    localStorage.setItem(HISTORY_STORAGE_KEY, '{not json');

    expect(readHistoryEntries()).toEqual([]);
  });
});

describe('historyStore actions', () => {
  beforeEach(() => {
    localStorage.clear();
    useHistoryStore.setState({ entries: [] });
  });

  it('addEntry prepends a new entry with id/timestamp and persists it', () => {
    const { addEntry } = useHistoryStore.getState();

    addEntry([makeSource('s1')], 'Invoice');

    const { entries } = useHistoryStore.getState();
    expect(entries).toHaveLength(1);
    expect(entries[0].presetLabel).toBe('Invoice');
    expect(entries[0].sources[0].id).toBe('s1');
    expect(entries[0].id).toBeTruthy();
    expect(Number.isNaN(Date.parse(entries[0].savedAt))).toBe(false);
    expect(readStored()[0].id).toBe(entries[0].id);
  });

  it('addEntry keeps the newest entry first', () => {
    const { addEntry } = useHistoryStore.getState();
    addEntry([makeSource('first')], 'Invoice');
    addEntry([makeSource('second')], 'Contact');

    const { entries } = useHistoryStore.getState();
    expect(entries).toHaveLength(2);
    expect(entries[0].sources[0].id).toBe('second');
    expect(entries[1].sources[0].id).toBe('first');
  });

  it(`addEntry evicts the oldest entry beyond the ${HISTORY_LIMIT}-entry cap`, () => {
    const { addEntry } = useHistoryStore.getState();
    for (let i = 0; i < HISTORY_LIMIT + 3; i += 1) {
      addEntry([makeSource(`s${i}`)], 'Invoice');
    }

    const { entries } = useHistoryStore.getState();
    expect(entries).toHaveLength(HISTORY_LIMIT);
    // Newest kept at the front, oldest three evicted.
    expect(entries[0].sources[0].id).toBe(`s${HISTORY_LIMIT + 2}`);
    expect(entries[entries.length - 1].sources[0].id).toBe('s3');
    expect(readStored()).toHaveLength(HISTORY_LIMIT);
  });

  it('removeEntry drops one entry and persists the change', () => {
    const { addEntry, removeEntry } = useHistoryStore.getState();
    addEntry([makeSource('s1')], 'Invoice');
    addEntry([makeSource('s2')], 'Invoice');
    const target = useHistoryStore.getState().entries[0];

    removeEntry(target.id);

    const { entries } = useHistoryStore.getState();
    expect(entries).toHaveLength(1);
    expect(entries[0].sources[0].id).toBe('s1');
    expect(readStored()).toHaveLength(1);
  });

  it('clear empties the store and the storage', () => {
    const { addEntry, clear } = useHistoryStore.getState();
    addEntry([makeSource('s1')], 'Invoice');

    clear();

    expect(useHistoryStore.getState().entries).toEqual([]);
    expect(localStorage.getItem(HISTORY_STORAGE_KEY)).toBe('[]');
  });

  it('updateResultField updates the field value, marks it reviewed, and persists the change', () => {
    const { addEntry, updateResultField } = useHistoryStore.getState();
    addEntry([makeSource('s1')], 'Invoice');

    updateResultField('s1', 'vendor', 'Globex');

    const result = useHistoryStore.getState().entries[0].sources[0].results[0];
    expect(result.data).toEqual({ vendor: 'Globex' });
    expect(result.reviewedFields).toEqual({ vendor: true });
    const storedResult = readStored()[0].sources[0].results[0];
    expect(storedResult.data).toEqual({ vendor: 'Globex' });
    expect(storedResult.reviewedFields).toEqual({ vendor: true });
  });

  it('updateResultField does nothing when the sourceId is not found', () => {
    const { addEntry, updateResultField } = useHistoryStore.getState();
    addEntry([makeSource('s1')], 'Invoice');
    const before = useHistoryStore.getState().entries;

    updateResultField('missing', 'vendor', 'Globex');

    expect(useHistoryStore.getState().entries).toEqual(before);
  });
});
