// @vitest-environment node
import { describe, expect, it } from 'vitest';

import config from '../vite.config.js';

// Regression: Vite's string shorthand for a proxy target turns changeOrigin ON, which rewrites the Host
// header and made the server refuse every POST (sign-in included) as "cross-site" in development.
describe('dev proxy', () => {
  it('keeps the browser\'s Host header for the API, downloads and WebSocket', () => {
    const { server } = config({ mode: 'development' });
    for (const path of ['/api', '/outputs', '/ws']) {
      expect(server.proxy[path], path).toMatchObject({ changeOrigin: false });
    }
    expect(server.proxy['/ws'].ws).toBe(true);
  });
});
