import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '@/i18n';
import { ResultRow } from './ResultRow';
import type { ExtractionResult } from '@/types/extraction';

const successResult: ExtractionResult = {
  sourceId: 'text-0',
  index: '1',
  status: 'success',
  data: { invoice_number: 'INV-2024-001', date: null, vendor: 'Acme Corp' },
  confidence: { invoice_number: 0.92, vendor: 0.88 },
  avgConfidence: 0.9,
  tokensUsed: { input: 100, output: 20 },
  costUsd: 0.0002,
};

const nestedResult: ExtractionResult = {
  sourceId: 'text-2',
  index: '1',
  status: 'success',
  data: {
    invoice_number: 'INV-2024-0877',
    line_items: [
      { description: 'Ergonomic office chair', quantity: 6, unit_price: 189.0, amount: 1134.0 },
      { description: 'Standing desk converter', quantity: 4, unit_price: 245.5, amount: 982.0 },
    ],
    tags: ['net-30', 'urgent'],
  },
  confidence: { invoice_number: 0.95, line_items: 0.88, tags: 0.8 },
  avgConfidence: 0.88,
  tokensUsed: { input: 200, output: 40 },
  costUsd: 0.0003,
};

const failedResult: ExtractionResult = {
  sourceId: 'text-1',
  index: '1',
  status: 'failed',
  data: null,
  confidence: {},
  avgConfidence: 0,
  tokensUsed: { input: 0, output: 0 },
  costUsd: 0,
  error: 'unable to parse scanned page',
};

describe('ResultRow', () => {
  it('renders the row label, field chips, confidence and cost for a successful result', () => {
    render(<ResultRow result={successResult} label="Text 1" />);

    expect(screen.getByText('Text 1')).toBeInTheDocument();
    expect(screen.getByText('INV-2024-001')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('0.90')).toBeInTheDocument();
    expect(screen.getByText('$0.0002')).toBeInTheDocument();
  });

  it('renders a null-value field as a "— field null" chip', () => {
    render(<ResultRow result={successResult} label="Text 1" />);

    expect(screen.getByText('— date null')).toBeInTheDocument();
  });

  it('renders an array of objects as a "field: N items" chip instead of [object Object]', () => {
    render(<ResultRow result={nestedResult} label="Text 3" />);

    expect(screen.getByText('line_items: 2 items')).toBeInTheDocument();
    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument();
  });

  it('renders an array of primitives as a comma-joined chip', () => {
    render(<ResultRow result={nestedResult} label="Text 3" />);

    expect(screen.getByText('net-30, urgent')).toBeInTheDocument();
  });

  it('renders the failed state with the error message, no confidence, and a Retry action', () => {
    render(<ResultRow result={failedResult} label="Text 2" />);

    expect(screen.getByText(/unable to parse scanned page/)).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('$0.0000')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View' })).not.toBeInTheDocument();
  });
});
