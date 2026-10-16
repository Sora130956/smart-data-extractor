import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { PAGE_SIZE, SourceGroup } from './SourceGroup';
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

/** A source holding `count` successful results labelled item_1 … item_N. */
function manyResultsSource(count: number): ExtractionSource {
  return {
    ...source,
    id: 'pdf-many',
    type: 'pdf',
    name: 'big.pdf',
    results: Array.from({ length: count }, (_, i) => ({
      sourceId: 'pdf-many',
      index: String(i + 1),
      status: 'success' as const,
      data: { code: `item_${i + 1}` },
      confidence: { code: 0.95 },
      avgConfidence: 0.95,
      tokensUsed: { input: 1, output: 1 },
      costUsd: 0, costCny: 0,
    })),
    stats: { ...source.stats, succeeded: count },
  };
}

describe('SourceGroup pagination (issue #14)', () => {
  afterEach(async () => {
    await i18next.changeLanguage('en');
  });

  it('shows no pager when results fit in one page', () => {
    render(<SourceGroup source={manyResultsSource(PAGE_SIZE)} />);

    expect(screen.getAllByRole('button', { name: 'View' })).toHaveLength(PAGE_SIZE);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('shows only the first page and a pager when results exceed a page', () => {
    render(<SourceGroup source={manyResultsSource(45)} />);

    expect(screen.getAllByRole('button', { name: 'View' })).toHaveLength(PAGE_SIZE);
    expect(screen.getByText('code: item_1')).toBeInTheDocument();
    expect(screen.queryByText('code: item_21')).not.toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('reaches results beyond the first page and keeps real item numbers', async () => {
    const user = userEvent.setup();
    render(<SourceGroup source={manyResultsSource(45)} />);

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(screen.getByText('code: item_21')).toBeInTheDocument();
    expect(screen.getByText('Text 21')).toBeInTheDocument();
    expect(screen.queryByText('code: item_1')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getAllByRole('button', { name: 'View' })).toHaveLength(5);
    expect(screen.getByText('code: item_45')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  it('passes the absolute result index to onView on later pages', async () => {
    const user = userEvent.setup();
    const onView = vi.fn();
    render(<SourceGroup source={manyResultsSource(45)} onView={onView} />);

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await user.click(screen.getAllByRole('button', { name: 'View' })[2]);

    expect(onView).toHaveBeenCalledTimes(1);
    expect(onView.mock.calls[0][1]).toBe(22);
    expect(onView.mock.calls[0][0].data).toEqual({ code: 'item_23' });
  });

  it('clamps to the last page when results shrink', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SourceGroup source={manyResultsSource(45)} />);
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await user.click(screen.getByRole('button', { name: 'Next page' }));

    rerender(<SourceGroup source={manyResultsSource(25)} />);

    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    expect(screen.getByText('code: item_25')).toBeInTheDocument();
  });

  it('localizes the pager', async () => {
    await i18next.changeLanguage('zh');
    render(<SourceGroup source={manyResultsSource(45)} />);

    expect(screen.getByRole('button', { name: '下一页' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上一页' })).toBeInTheDocument();
  });
});

describe('SourceGroup', () => {
  // Restore the default language even if a test fails mid-switch.
  afterEach(async () => {
    await i18next.changeLanguage('en');
  });

  it('renders the source name, meta, and an "ok" badge with its result rows', () => {
    render(<SourceGroup source={source} />);

    expect(screen.getByText('Manual Input 1')).toBeInTheDocument();
    expect(screen.getByText(/Invoice INV-2024-001/)).toBeInTheDocument();
    expect(screen.getByText('1 ok')).toBeInTheDocument();
    expect(screen.queryByText(/failed/)).not.toBeInTheDocument();
    expect(screen.getByText('Text 1')).toBeInTheDocument();
    expect(screen.getByText('invoice_number: INV-2024-001')).toBeInTheDocument();
  });

  it('labels result chips with the source display-name map', async () => {
    await i18next.changeLanguage('zh');
    render(
      <SourceGroup
        source={{ ...source, fieldLabels: { invoice_number: '发票号', vendor: '供应商' } }}
      />,
    );

    expect(screen.getByText('发票号：INV-2024-001')).toBeInTheDocument();
    expect(screen.getByText('供应商：Acme Corp')).toBeInTheDocument();
  });

  it('renders a "failed" badge when the source has failed results', () => {
    render(<SourceGroup source={mixedSource} />);

    expect(screen.getByText('1 failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
