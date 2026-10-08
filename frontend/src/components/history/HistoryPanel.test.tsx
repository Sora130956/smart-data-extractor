// HistoryPanel: modal listing persisted extraction batches; a row click
// restores that batch into the main result list (newest-first accumulate).

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { HistoryPanel } from './HistoryPanel';
import { useHistoryStore, HISTORY_STORAGE_KEY, type HistoryEntry } from '@/store/historyStore';
import type { ExtractionSource } from '@/types/extraction';

function makeSource(id: string): ExtractionSource {
  return {
    id,
    type: 'text',
    name: 'Manual Input 1',
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

const entries: HistoryEntry[] = [
  {
    id: 'e1',
    savedAt: '2026-10-08T08:30:00.000Z',
    presetLabel: 'Invoice',
    sources: [makeSource('s1'), makeSource('s2')],
  },
  {
    id: 'e2',
    savedAt: '2026-10-07T08:30:00.000Z',
    presetLabel: 'Contact',
    sources: [makeSource('s3')],
  },
];

function renderPanel(onRestore = vi.fn()) {
  const onClose = vi.fn();
  render(<HistoryPanel onClose={onClose} onRestore={onRestore} />);
  return { onRestore, onClose };
}

describe('HistoryPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    useHistoryStore.setState({ entries: [] });
  });

  it('shows guidance copy when there is no history', () => {
    renderPanel();

    expect(screen.getByText(/No history yet/i)).toBeInTheDocument();
  });

  it('renders one clickable row per entry with its preset label and source count', () => {
    useHistoryStore.setState({ entries });
    renderPanel();

    expect(screen.getByRole('button', { name: /Invoice/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Contact/ })).toBeInTheDocument();
    expect(screen.getByText(/2 sources/)).toBeInTheDocument();
  });

  it('restores the clicked entry (closing the panel is the owner\'s job)', async () => {
    const user = userEvent.setup();
    useHistoryStore.setState({ entries });
    const { onRestore } = renderPanel();

    await user.click(screen.getByRole('button', { name: /Invoice/ }));

    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledWith(entries[0]);
  });

  it('clears all entries via the Clear All button and persists the change', async () => {
    const user = userEvent.setup();
    useHistoryStore.setState({ entries });
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Clear All' }));

    expect(useHistoryStore.getState().entries).toEqual([]);
    expect(localStorage.getItem(HISTORY_STORAGE_KEY)).toBe('[]');
    expect(screen.getByText(/No history yet/i)).toBeInTheDocument();
  });
});
