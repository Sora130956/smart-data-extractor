import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '@/i18n';
import { SourceGroup } from './SourceGroup';
import type { ExtractionSource } from '@/types/extraction';

const source: ExtractionSource = {
  id: 'text-0',
  type: 'text',
  name: 'Manual Input 1',
  uploadedAt: '2024-03-14T00:00:00.000Z',
  meta: 'Invoice INV-2024-001 dated 2024-03-14 for Acme Corp…',
  results: [
    {
      sourceId: 'text-0',
      index: '1',
      status: 'success',
      data: { invoice_number: 'INV-2024-001', vendor: 'Acme Corp' },
      confidence: { invoice_number: 0.92, vendor: 0.88 },
      avgConfidence: 0.9,
      tokensUsed: { input: 100, output: 20 },
      costUsd: 0.0002, costCny: 0.00145,
    },
  ],
  stats: {
    succeeded: 1, failed: 0, totalCostUsd: 0.0002, totalCostCny: 0.00145, avgConfidence: 0.9,
    schemaResolveCostUsd: 0, schemaResolveCostCny: 0,
  },
};

const mixedSource: ExtractionSource = {
  id: 'text-1',
  type: 'text',
  name: 'Manual Input 2',
  uploadedAt: '2024-03-14T00:00:00.000Z',
  meta: '',
  results: [
    {
      sourceId: 'text-1',
      index: '1',
      status: 'failed',
      data: null,
      confidence: {},
      avgConfidence: 0,
      tokensUsed: { input: 0, output: 0 },
      costUsd: 0, costCny: 0,
      error: 'unable to parse scanned page',
    },
  ],
  stats: {
    succeeded: 0, failed: 1, totalCostUsd: 0, totalCostCny: 0, avgConfidence: 0,
    schemaResolveCostUsd: 0, schemaResolveCostCny: 0,
  },
};

describe('SourceGroup', () => {
  it('renders the source name, meta, and an "ok" badge with its result rows', () => {
    render(<SourceGroup source={source} />);

    expect(screen.getByText('Manual Input 1')).toBeInTheDocument();
    expect(screen.getByText(/Invoice INV-2024-001/)).toBeInTheDocument();
    expect(screen.getByText('1 ok')).toBeInTheDocument();
    expect(screen.queryByText(/failed/)).not.toBeInTheDocument();
    expect(screen.getByText('Text 1')).toBeInTheDocument();
    expect(screen.getByText('INV-2024-001')).toBeInTheDocument();
  });

  it('renders a "failed" badge when the source has failed results', () => {
    render(<SourceGroup source={mixedSource} />);

    expect(screen.getByText('1 failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
