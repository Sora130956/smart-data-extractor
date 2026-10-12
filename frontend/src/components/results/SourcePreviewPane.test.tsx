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
    editingField: null,
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

  it('overlays only the active field box on the current page, colored by review state', () => {
    const boxes = {
      vendor: { page: 0, box: [10, 20, 30, 40] },
      invoice_number: { page: 0, box: [5, 5, 6, 6] },
    };

    // Only the field being edited/located gets a box — not every match.
    const vendorRender = renderPane({
      source: { ...base, pageImages: ['aGk='] },
      boxes,
      reviewFields: new Set(['vendor']),
      reviewedFields: new Set(['invoice_number']),
      editingField: 'vendor',
    });
    const vendorBox = vendorRender.container.querySelector('[data-field="vendor"]');
    expect(vendorBox).not.toBeNull();
    expect(vendorBox).toHaveStyle({ left: '10%', top: '20%', width: '20%', height: '20%' });
    // A field needing review gets the warning color.
    expect(vendorBox?.className).toContain('warning');
    expect(vendorRender.container.querySelector('[data-field="invoice_number"]')).toBeNull();
    vendorRender.unmount();

    const invoiceRender = renderPane({
      source: { ...base, pageImages: ['aGk='] },
      boxes,
      reviewFields: new Set(['vendor']),
      reviewedFields: new Set(['invoice_number']),
      editingField: 'invoice_number',
    });
    // A reviewed field gets the success color.
    const invoiceBox = invoiceRender.container.querySelector('[data-field="invoice_number"]');
    expect(invoiceBox?.className).toContain('success');
    expect(invoiceRender.container.querySelector('[data-field="vendor"]')).toBeNull();
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
      editingField: 'vendor',
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

describe('SourcePreviewPane zoom + centering (review UX)', () => {
  /** jsdom has no layout: give the rendered page image a fake fit-width. */
  function mockImgWidth(container: HTMLElement, width: number) {
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    Object.defineProperty(img, 'offsetWidth', { configurable: true, value: width });
    return img as HTMLImageElement;
  }

  it('centers the page image in the pane via flex + auto margins', () => {
    const { container } = renderPane({ source: { ...base, pageImages: ['aGk='] } });

    const region = screen.getByRole('region', { name: 'Original File' });
    // Auto-margin centering is overflow-safe: when the (zoomed) image is
    // larger than the pane the margins collapse to 0 and scrolling works.
    expect(region.className).toContain('flex');
    const wrap = container.querySelector('div.relative');
    expect(wrap?.className).toContain('m-auto');
  });

  it('zooms the page image with the wheel while the box overlay follows', () => {
    const { container } = renderPane({
      source: { ...base, pageImages: ['aGk='] },
      boxes: { vendor: { page: 0, box: [10, 20, 30, 40] } },
      editingField: 'vendor',
    });
    mockImgWidth(container, 400);

    fireEvent.wheel(screen.getByRole('region', { name: 'Original File' }), { deltaY: -120 });

    const img = container.querySelector('img');
    expect(img).toHaveStyle({ width: '500px' }); // 400px fit-width x 1.25
    // The percentage overlay keeps mapping 1:1 onto the enlarged image:
    // the wrapper must grow past the pane (no max-w-full clamp) and the
    // box stays rendered on it.
    const wrap = container.querySelector('div.relative');
    expect(wrap?.className).not.toContain('max-w-full');
    expect(container.querySelector('[data-field="vendor"]')).not.toBeNull();
  });

  it('zooming back to 100% returns to the fit-width rendering', () => {
    const { container } = renderPane({ source: { ...base, pageImages: ['aGk='] } });
    mockImgWidth(container, 400);
    const region = screen.getByRole('region', { name: 'Original File' });

    fireEvent.wheel(region, { deltaY: -120 }); // 125%
    fireEvent.wheel(region, { deltaY: 120 }); // back to 100%

    const img = container.querySelector('img');
    // React clears inline styles to style=""; what matters is no width.
    expect(img?.getAttribute('style') ?? '').not.toContain('width');
    expect(img?.className).toContain('max-w-full');
  });

  it('double-click on the image resets the zoom', () => {
    const { container } = renderPane({ source: { ...base, pageImages: ['aGk='] } });
    mockImgWidth(container, 400);
    fireEvent.wheel(screen.getByRole('region', { name: 'Original File' }), { deltaY: -120 });

    fireEvent.dblClick(container.querySelector('img') as HTMLImageElement);

    expect(container.querySelector('img')?.getAttribute('style') ?? '').not.toContain('width');
  });

  it('switching pages resets the zoom', () => {
    const { container } = renderPane({ source: { ...base, pageImages: ['aGk=', 'Ynk='] } });
    mockImgWidth(container, 400);
    fireEvent.wheel(screen.getByRole('region', { name: 'Original File' }), { deltaY: -120 });

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));

    // New page renders at its own fit width, zoom level dropped.
    expect(container.querySelector('img')?.getAttribute('style') ?? '').not.toContain('width');
  });

  it('shows the zoom level as a button that resets it', () => {
    const { container } = renderPane({ source: { ...base, pageImages: ['aGk='] } });
    mockImgWidth(container, 400);

    expect(screen.queryByText('125%')).not.toBeInTheDocument();
    fireEvent.wheel(screen.getByRole('region', { name: 'Original File' }), { deltaY: -120 });

    const reset = screen.getByRole('button', { name: 'Reset zoom' });
    expect(reset).toHaveTextContent('125%');
    fireEvent.click(reset);

    expect(container.querySelector('img')?.getAttribute('style') ?? '').not.toContain('width');
    expect(screen.queryByText('125%')).not.toBeInTheDocument();
  });

  it('the wheel does nothing on the text view (no crash, no zoom ui)', () => {
    renderPane();
    fireEvent.click(screen.getByRole('button', { name: 'Extracted Text' }));
    const region = screen.getByRole('region', { name: 'Extracted Text' });
    fireEvent.wheel(region, { deltaY: -120 });
    expect(screen.queryByText('125%')).not.toBeInTheDocument();
  });
});
