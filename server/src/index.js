/**
 * Entry point: `npm start` (production) or `npm run dev`.
 *
 * Serves the React build, the REST API, the download endpoint and the
 * live log/progress WebSocket from a single process.
 */

import { createServer } from 'node:http';

import { ALLOWED_EMAILS } from './allowedEmails.js';
import { createApp } from './app.js';
import { DATABASE_PATH, GOOGLE_CLIENT_ID, HOST, PORT, SCRAPER_MOCK, SESSION_DAYS } from './config.js';
import { createAuth, createGoogleVerifier } from './services/auth.js';
import { checkScraperEnvironment } from './services/diagnostics.js';
import { jobManager } from './services/jobManager.js';
import { createStore } from './services/store.js';
import { attachWebSocket } from './ws.js';

// ----------------------------------------------------------------------
// Database and sign-in
// ----------------------------------------------------------------------

const store = createStore(DATABASE_PATH);
const interrupted = store.failStaleSearches();
if (interrupted) console.log(`Marked ${interrupted} search(es) left over from a previous run as interrupted.`);
store.purgeExpiredSessions();
const purgeTimer = setInterval(() => store.purgeExpiredSessions(), 60 * 60 * 1000);
purgeTimer.unref();

const auth = createAuth({
  store,
  verify: GOOGLE_CLIENT_ID ? createGoogleVerifier(GOOGLE_CLIENT_ID) : null,
  allowedEmails: ALLOWED_EMAILS,
  clientId: GOOGLE_CLIENT_ID,
  sessionDays: SESSION_DAYS,
});

// When a search ends, record how it went in the person's history.
jobManager.on('finished', (e) => {
  try {
    store.finishSearch(e.historyId, e.userId, { status: e.status, caseCount: e.caseCount, error: e.error });
  } catch (err) {
    console.error('Could not update the search history:', err);
  }
});

const app = createApp(jobManager, { store, auth });
const server = createServer(app);

// Live updates, delivered only to the person whose search they belong to.
const live = attachWebSocket(server, { auth, jobManager });

// ----------------------------------------------------------------------
// Start / stop
// ----------------------------------------------------------------------

server.listen(PORT, HOST, () => {
  console.log(`iudicium. listening on http://${HOST}:${PORT}${SCRAPER_MOCK ? '  (SCRAPER_MOCK: using synthetic data)' : ''}`);
  console.log(`Database: ${DATABASE_PATH}`);
  if (!GOOGLE_CLIENT_ID) console.warn('\n!! GOOGLE_CLIENT_ID is not set: nobody can sign in until you add it to .env (see README: "Google sign-in").\n');
  const real = ALLOWED_EMAILS.filter((e) => e && e.toLowerCase() !== 'your.name@gmail.com');
  if (!real.length) console.warn('!! No real email address is listed in server/src/allowedEmails.js: nobody will be allowed in.\n');
  else console.log(`Allowed accounts: ${real.length}`);
});

// Say up front whether searches can work, so a broken setup is obvious in the terminal.
checkScraperEnvironment({ force: true }).then((report) => {
  if (report.ok) {
    console.log(report.mock ? 'Scraper: mock mode (synthetic data, no browser needed)' : `Scraper ready: Python ${report.version} (${report.python}), Tesseract ${report.tesseract}`);
  } else {
    console.warn('\n!! The scraper is NOT ready -- searches will fail until this is fixed:');
    for (const problem of report.problems) console.warn(`   - ${problem}`);
    console.warn('');
  }
});

server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Set PORT in .env.` : err);
  process.exit(1);
});

function shutdown() {
  live.close();
  jobManager.shutdown();
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
