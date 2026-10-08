import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { ResultsHeader, EMPTY_COUNTS } from './ResultsHeader';
import type { ExtractionSource } from '@/types/extraction';

const sources: ExtractionSource[] = [
  {
    id: 'text-0',
    type: 'text',
    name: 'Manual Input 1',
    uploadedAt: '2024-03-14T00:00:00.000Z',
    results: [
      {
        sourceId: 'text-0',
        index: '1',
        status: 'success',
        data: { vendor: 'Acme Corp' },
        confidence: { vendor: 0.9 },
        avgConfidence: 0.9,
        tokensUsed: { input: 100, output: 20 },
        costUsd: 0.0002,
        costCny: 0.00145,
      },
    ],
    stats: {
      succeeded: 1,
      failed: 0,
      totalCostUsd: 0.0002,
      totalCostCny: 0.00145,
      avgConfidence: 0.9,
      schemaResolveCostUsd: 0,
      schemaResolveCostCny: 0,
    },
  },
];

describe('ResultsHeader', () => {
  it('disables Export All JSON when there are no results', () => {
    render(<ResultsHeader counts={EMPTY_COUNTS} sources={[]} />);

    expect(screen.getByRole('button', { name: 'Export All JSON' })).toBeDisabled();
  });

  describe('Export All JSON', () => {
    beforeEach(() => {
      URL.createObjectURL = vi.fn(() => 'blob:mock-url');
      URL.revokeObjectURL = vi.fn();
    });

    it('triggers a JSON file download containing the sources', async () => {
      const user = userEvent.setup();
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      render(<ResultsHeader counts={{ all: 1, high: 1, review: 0 }} sources={sources} />);

      await user.click(screen.getByRole('button', { name: 'Export All JSON' }));

      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

      clickSpy.mockRestore();
    });
  });
});
