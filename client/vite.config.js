import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// In development the React dev server (5173) proxies API, download and
// WebSocket traffic to the Express server, so the browser sees one origin
// -- exactly like production, where Express serves the built files itself.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '..', ''); // the root .env holds PORT
  const target = `http://127.0.0.1:${env.PORT || 8000}`;

  return {
    plugins: [react()],
    server: {
      port: 5173,
      // changeOrigin must stay false: it would rewrite the Host header to the backend's address, and the
      // server (which refuses cross-site requests by comparing Origin with Host) would then reject every
      // POST, including signing in. Vite's plain-string shorthand turns changeOrigin ON, so spell it out.
      proxy: {
        '/api': { target, changeOrigin: false },
        '/outputs': { target, changeOrigin: false },
        '/ws': { target, changeOrigin: false, ws: true },
      },
    },
    build: { outDir: 'dist', chunkSizeWarningLimit: 700 },
    test: { environment: 'jsdom', globals: true, setupFiles: './test/setup.js' },
  };
});
