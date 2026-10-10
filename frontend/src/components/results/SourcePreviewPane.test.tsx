// SourcePreviewPane (issue #4 / D-027): the file view overlays locate boxes
// on the original file so reviewers verify values against the source image
// in place. PDFs render the backend's per-page images (iframe fallback for
// legacy data); images embed their blob url as a single page.

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { SourcePreviewPane } from './SourcePreviewPane';
import type { ExtractionSource } from '@/types/extraction';

const base: ExtractionSource = {
  id: 'text-0',
  type: 'pdf',
  name: 'scan.pdf',
  uploadedAt: '2024-03-14T00:00:00.000Z',
  sourceFileUrl: 'blob:pdf',
  sourceText: 'INVOICE\nVendor: Acme Corp\n',
  results: [],
  stats: {
    succeeded: 1, failed: 0, totalCostUsd: 0.0002, totalCostCny: 0.00145, avgConfidence: 0.9,
    schemaResolveCostUsd: 0, schemaResolveCostCny: 0,
  },
};

function renderPane(overrides: Record<string, unknown> = {}) {
  const props = {
    source: base,
    ranges: {},
    reviewFields: new Set<string>(),
    reviewedFields: new Set<string>(),
    focus: null,
    boxes: {},
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<SourcePreviewPane {...(props as any)} />);
}

describe('SourcePreviewPane file view (D-027)', () => {
  it('renders per-page base64 images instead of an iframe when page renders exist', () => {
    renderPane({ source: { ...base, pageImages: ['aGk='] } });

    const filePane = screen.getByRole('region', { name: 'Original File' });
    expect(within(filePane).getByRole('img', { name: 'scan.pdf' })).toHaveAttribute(
      'src',
      'data:image/png;base64,aGk=',
    );
    expect(within(filePane).queryByTitle('scan.pdf')).not.toBeInTheDocument();
  });

  it('falls back to an iframe for pdf sources without page renders (legacy data)', () => {
    renderPane();

    const filePane = screen.getByRole('region', { name: 'Original File' });
    expect(within(filePane).getByTitle('scan.pdf')).toHaveAttribute('src', 'blob:pdf');
  });

  it('embeds an image source as a single page without a pager', () => {
    renderPane({ source: { ...base, type: 'image', sourceFileUrl: 'blob:img' } });

    const filePane = screen.getByRole('region', { name: 'Original File' });
    expect(within(filePane).getByRole('img', { name: 'scan.pdf' })).toHaveAttribute('src', 'blob:img');
    expect(screen.queryByText('Page 1 / 1')).not.toBeInTheDocument();
  });

  it('overlays locate boxes on the current page, colored by review state', () => {
    const { container } = renderPane({
      source: { ...base, pageImages: ['aGk='] },
      boxes: {
        vendor: { page: 0, box: [10, 20, 30, 40] },
        invoice_number: { page: 0, box: [5, 5, 6, 6] },
      },
      reviewFields: new Set(['vendor']),
      reviewedFields: new Set(['invoice_number']),
    });

    const vendorBox = container.querySelector('[data-field="vendor"]');
    expect(vendorBox).not.toBeNull();
    expect(vendorBox).toHaveStyle({ left: '10%', top: '20%', width: '20%', height: '20%' });
    // A field needing review gets the warning color.
    expect(vendorBox?.className).toContain('warning');
    // A reviewed field gets the success color.
    const invoiceBox = container.querySelector('[data-field="invoice_number"]');
    expect(invoiceBox?.className).toContain('success');
  });

  it('shows a pager for multi-page pdfs and switches pages', () => {
    renderPane({ source: { ...base, pageImages: ['aGk=', 'Ynk='] } });

    expect(screen.getByText('Page 1 / 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));

    expect(screen.getByText('Page 2 / 2')).toBeInTheDocument();
    const filePane = screen.getByRole('region', { name: 'Original File' });
    expect(within(filePane).getByRole('img', { name: 'scan.pdf' })).toHaveAttribute(
      'src',
      'data:image/png;base64,Ynk=',
    );
    // Previous becomes available, next is disabled on the last page.
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
  });

  it('only draws a box on the page it was found on', () => {
    const { container } = renderPane({
      source: { ...base, pageImages: ['aGk=', 'Ynk='] },
      boxes: { vendor: { page: 1, box: [10, 20, 30, 40] } },
    });

    // Page 1: the vendor box lives on page 2, nothing is overlaid here.
    expect(container.querySelector('[data-field="vendor"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(container.querySelector('[data-field="vendor"]')).not.toBeNull();
  });

  it('a locate focus with a box switches to the file view, jumps to its page and flashes it', () => {
    const { container } = renderPane({
      source: { ...base, pageImages: ['aGk=', 'Ynk='] },
      boxes: { vendor: { page: 1, box: [10, 20, 30, 40] } },
      focus: { field: 'vendor', nonce: 1 },
    });

    // Jumped straight to the box's page.
    expect(screen.getByText('Page 2 / 2')).toBeInTheDocument();
    const box = container.querySelector('[data-field="vendor"]');
    expect(box).not.toBeNull();
    expect(box?.className).toContain('animate-pulse');
  });

  it('a locate focus without a box degrades to the text view highlight', () => {
    // jsdom does not implement scrollIntoView; the text fallback scrolls the
    // matched highlight into view.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      renderPane({
        source: { ...base, pageImages: ['aGk='] },
        ranges: { vendor: [8, 17] },
        focus: { field: 'vendor', nonce: 1 },
      });

      expect(screen.getByRole('region', { name: 'Extracted Text' })).toBeInTheDocument();
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});
