import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

// jsdom doesn't implement createObjectURL for jsdom File/Blob objects (the
// Node global exists but rejects them), so stub it unconditionally —
// components that call it (e.g. to preview uploaded pdf/image files) would
// otherwise throw in tests.
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:mock-url');
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});
