/**
 * Builds the Express app (no listening here, so tests can mount it).
 */

import { access } from 'node:fs/promises';
import path from 'node:path';

import express from 'express';

import { CLIENT_DIST, OUTPUT_DIR, TRUST_PROXY } from './config.js';
import { createApiRouter } from './routes/api.js';
import { userOutputDir } from './services/jobManager.js';
import { isSameSite } from './utils/origin.js';

// Old multi-page URLs -> React routes, so existing bookmarks keep working.
const LEGACY_PAGES = {
  '/index.html': '/',
  '/assistant.html': '/assistant',
  '/search.html': '/search',
  '/case-number.html': '/quick-search',
  '/guide.html': '/guide',
  '/faq.html': '/faq',
};

const DOWNLOAD_TYPES = new Set(['.xlsx', '.zip']);

export function createApp(jobManager, { store, auth, outputDir = OUTPUT_DIR, clientDist = CLIENT_DIST } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', TRUST_PROXY); // behind Cloud Run / a load balancer, so req.secure reflects HTTPS
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  // The assistant posts the fetched cases back each turn, so allow a generous body.
  app.use(express.json({ limit: '10mb' }));

  // Refuse state-changing requests that were triggered from another website.
  app.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !isSameSite(req.get('origin'), req.headers, TRUST_PROXY)) {
      return res.status(403).json({ error: 'Cross-site request refused.' });
    }
    return next();
  });

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' })); // open: used by load balancers
  app.use('/api/auth', auth.router);

  // Everything else under /api, and the downloads, needs a signed-in, allow-listed user.
  app.use('/api', auth.authenticate, auth.requireAuth, createApiRouter(jobManager, store));

  // Finished workbooks: each person can only reach files in their own folder.
  app.get('/outputs/:filename', auth.authenticate, auth.requireAuth, (req, res) => {
    const name = path.basename(req.params.filename);
    const file = path.resolve(userOutputDir(outputDir, req.user.id), name);
    if (name !== req.params.filename || !DOWNLOAD_TYPES.has(path.extname(name).toLowerCase())) {
      return res.status(404).json({ error: 'File not found.' });
    }
    res.download(file, name, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'File not found.' });
    });
  });

  for (const [from, to] of Object.entries(LEGACY_PAGES)) app.get(from, (_req, res) => res.redirect(301, to));

  // The built React app, with client-side routes falling back to index.html.
  app.use(express.static(clientDist));
  app.get(/^\/(?!api\/|outputs\/|ws\/).*/, async (_req, res) => {
    const indexFile = path.join(clientDist, 'index.html');
    try {
      await access(indexFile);
      res.sendFile(indexFile);
    } catch {
      res
        .status(200)
        .type('text/plain')
        .send('The web UI has not been built yet. Run `npm run build` (or `npm run dev` for development).');
    }
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON.' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error.' });
  });

  return app;
}
