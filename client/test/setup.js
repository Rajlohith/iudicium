import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
  vi.restoreAllMocks();
});

// jsdom has no layout or scrolling.
if (typeof window !== 'undefined') {
  window.scrollTo = () => {};
  window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
}
