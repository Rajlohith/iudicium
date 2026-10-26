import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

// Mock mode skips the Python environment pre-flight; the job itself runs a fake worker.
process.env.SCRAPER_MOCK = 'true';

const { createApp } = await import('../src/app.js');
const { createAuth, SESSION_COOKIE } = await import('../src/services/auth.js');
const { JobManager } = await import('../src/services/jobManager.js');
const { createStore } = await import('../src/services/store.js');

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fakeWorker.mjs');
const LONG = 'x'.repeat(40); // credentials must look like JWTs, length-wise

// What Google would say for each fake credential.
const GOOGLE = {
  [`ann${LONG}`]: { sub: 'g-ann', email: 'Ann@Example.com', email_verified: true, name: 'Ann Rao', picture: 'https://pic/ann' },
  [`bob${LONG}`]: { sub: 'g-bob', email: 'bob@example.com', email_verified: true, name: 'Bob Das' },
  [`eve${LONG}`]: { sub: 'g-eve', email: 'eve@elsewhere.com', email_verified: true, name: 'Eve Mallory' },
  [`unv${LONG}`]: { sub: 'g-unv', email: 'ann@example.com', email_verified: false, name: 'Unverified' },
};
const verify = async (credential) => {
  if (!GOOGLE[credential]) throw new Error('bad signature');
  return GOOGLE[credential];
};

let dir, store, jm, server, base;
const jar = { ann: '', bob: '' };

async function listen(app) {
  const s = await new Promise((resolve) => { const x = app.listen(0, '127.0.0.1', () => resolve(x)); });
  return { s, url: `http://127.0.0.1:${s.address().port}` };
}

async function call(method, url, { who, body, headers = {} } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(who && jar[who] ? { Cookie: jar[who] } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.clone().json(); } catch { /* not JSON */ }
  return { status: res.status, data, res };
}

async function signIn(who, credential) {
  const r = await call('POST', '/api/auth/google', { body: { credential } });
  const cookie = r.res.headers.get('set-cookie');
  if (cookie) jar[who] = cookie.split(';')[0];
  return r;
}

const waitUntilIdle = async (who) => {
  for (let i = 0; i < 100; i += 1) {
    const { data } = await call('GET', '/api/search/status', { who });
    if (!data.mine) { await new Promise((r) => setTimeout(r, 30)); return; }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('search never finished');
};

before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'iud-acc-'));
  await mkdir(path.join(dir, 'dist'));
  store = createStore(':memory:');
  jm = new JobManager({
    workerCommand: (mode, specPath) => ({ cmd: process.execPath, args: [fake, mode, specPath] }),
    outputDir: path.join(dir, 'out'), tmpDir: path.join(dir, 'tmp'), debugDir: path.join(dir, 'dbg'),
    writeWorkbook: async (file) => writeFile(file, 'xlsx-bytes'),
  });
  jm.on('finished', (e) => store.finishSearch(e.historyId, e.userId, { status: e.status, caseCount: e.caseCount, error: e.error }));
  const auth = createAuth({ store, verify, allowedEmails: ['ann@example.com', 'BOB@example.com'], clientId: 'client-123' });
  ({ s: server, url: base } = await listen(createApp(jm, { store, auth, outputDir: path.join(dir, 'out'), clientDist: path.join(dir, 'dist') })));
});

after(async () => {
  server.close();
  store.close();
  await rm(dir, { recursive: true, force: true });
});

describe('the front door', () => {
  it('only the health check and sign-in endpoints are open', async () => {
    assert.equal((await call('GET', '/api/health')).status, 200);
    assert.equal((await call('GET', '/api/auth/config')).data.client_id, 'client-123');
    assert.equal((await call('GET', '/api/auth/me')).data.user, null);
    for (const [method, url] of [['GET', '/api/form-options'], ['GET', '/api/history'], ['POST', '/api/search'], ['GET', '/api/search/status'],
      ['GET', '/api/logs/search'], ['POST', '/api/assistant'], ['GET', '/api/diagnostics'], ['GET', '/outputs/anything.xlsx']]) {
      assert.equal((await call(method, url, { body: method === 'POST' ? {} : undefined })).status, 401, `${method} ${url}`);
    }
  });

  it('serves the app shell without signing in (the login page needs it)', async () => {
    assert.equal((await call('GET', '/')).status, 200);
  });
});

describe('signing in with Google', () => {
  it('turns away accounts that are not on the allow-list, without creating them', async () => {
    const r = await signIn('eve', `eve${LONG}`);
    assert.equal(r.status, 403);
    assert.equal(r.data.code, 'not_allowed');
    assert.match(r.data.error, /eve@elsewhere\.com.*allowedEmails\.js/);
    assert.equal(r.res.headers.get('set-cookie'), null);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
  });

  it('rejects an unverified email, a forged token and a malformed request', async () => {
    assert.equal((await signIn('ann', `unv${LONG}`)).data.code, 'unverified_email');
    assert.equal((await signIn('ann', `forged${LONG}`)).data.code, 'invalid_token');
    assert.equal((await call('POST', '/api/auth/google', { body: { credential: 'short' } })).status, 400);
    assert.equal(jar.ann, '');
  });

  it('lets an allowed account in (case-insensitive) and stores the name from Google', async () => {
    const r = await signIn('ann', `ann${LONG}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.user, { id: 1, email: 'ann@example.com', name: 'Ann Rao', picture: 'https://pic/ann' });
    const cookie = r.res.headers.get('set-cookie');
    assert.match(cookie, new RegExp(`^${SESSION_COOKIE}=`));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.equal((await call('GET', '/api/auth/me', { who: 'ann' })).data.user.name, 'Ann Rao');
    assert.equal((await call('GET', '/api/form-options', { who: 'ann' })).status, 200);
    await signIn('bob', `bob${LONG}`);
  });

  it('refreshes the stored name when Google reports a new one', async () => {
    GOOGLE[`ann${LONG}`].name = 'Ann Rao-Iyer';
    await signIn('ann', `ann${LONG}`);
    assert.equal((await call('GET', '/api/auth/me', { who: 'ann' })).data.user.name, 'Ann Rao-Iyer');
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2); // updated, not duplicated
  });

  it('never keeps the raw session token in the database', () => {
    const token = jar.ann.split('=')[1];
    const rows = store.db.prepare('SELECT token_hash FROM sessions').all();
    assert.ok(rows.length >= 1);
    assert.ok(rows.every((r) => r.token_hash !== token && r.token_hash.length === 64));
  });

  it('removing an address from the allow-list locks that person out immediately', async () => {
    const narrowed = createAuth({ store, verify, allowedEmails: ['bob@example.com'], clientId: 'c' });
    const { s, url } = await listen(createApp(jm, { store, auth: narrowed, outputDir: path.join(dir, 'out'), clientDist: path.join(dir, 'dist') }));
    try {
      const as = (who) => fetch(`${url}/api/form-options`, { headers: { Cookie: jar[who] } }).then((r) => r.status);
      assert.equal(await as('ann'), 401);
      assert.equal(await as('bob'), 200);
    } finally { s.close(); }
  });

  it('refuses state-changing requests that come from another website', async () => {
    const r = await call('POST', '/api/search/stop', { who: 'ann', headers: { Origin: 'http://evil.example' } });
    assert.equal(r.status, 403);
    const ok = await call('POST', '/api/search/stop', { who: 'ann', headers: { Origin: base } });
    assert.equal(ok.status, 200);
  });
});

const detailed = { db_bench: 'B', from_date: '01-01-2024', to_date: '31-01-2024', respondent_name: 'Infosys', aliases: ['Wipro'], alias_field: 'respondname', output_filename: 'mine' };

describe('search history', () => {
  it('records form searches with their parameters, outcome and case count', async () => {
    const started = await call('POST', '/api/search', { who: 'ann', body: detailed });
    assert.equal(started.data.started, true);
    await waitUntilIdle('ann');

    const quick = await call('POST', '/api/case-number-search', { who: 'ann', body: { db_bench: 'D', case_type: '144', case_no: '48907', case_year: '2023' } });
    assert.equal(quick.data.started, true);
    await waitUntilIdle('ann');

    const { searches } = (await call('GET', '/api/history', { who: 'ann' })).data;
    assert.equal(searches.length, 2);
    const [newest, oldest] = searches; // newest first
    assert.deepEqual([newest.kind, newest.source, newest.status, newest.case_count], ['quick', 'form', 'done', 20]);
    assert.equal(newest.title, 'WP 48907/2023 · Dharwad Bench');
    assert.deepEqual(newest.params, { db_bench: 'D', case_type: '144', case_no: '48907', case_year: '2023' });
    assert.deepEqual([oldest.kind, oldest.source, oldest.status], ['detailed', 'form', 'done']);
    assert.match(oldest.title, /Principal Bench · 01-01-2024 → 31-01-2024 · Respondent: Infosys/);
    assert.equal(oldest.params.aliases[0], 'Wipro'); // everything needed to run it again
    assert.ok(oldest.created_at && oldest.finished_at);
  });

  it('records assistant searches, as the Detailed or Quick search they really were', async () => {
    const quick = await call('POST', '/api/assistant/run', { who: 'ann', body: { fields: { db_bench: 'B', case_type: '144', case_no: '12', case_year: '2020' } } });
    assert.deepEqual([quick.data.started, quick.data.mode], [true, 'quick']);
    await waitUntilIdle('ann');
    const detailedRun = await call('POST', '/api/assistant/run', { who: 'ann', body: { fields: { db_bench: 'K', from_date: '01-02-2024', to_date: '28-02-2024', respondent_name: 'State' } } });
    assert.equal(detailedRun.data.mode, 'detailed');
    await waitUntilIdle('ann');

    const [d, q] = (await call('GET', '/api/history', { who: 'ann' })).data.searches;
    assert.deepEqual([d.kind, d.source, d.params.respondent_name], ['detailed', 'assistant', 'State']);
    assert.deepEqual([q.kind, q.source, q.params.case_no], ['quick', 'assistant', '12']);
  });

  it('does not record a search that could not start (scraper busy)', async () => {
    const before = (await call('GET', '/api/history', { who: 'ann' })).data.searches.length;
    assert.equal((await call('POST', '/api/search', { who: 'ann', body: detailed })).data.started, true);
    const again = await call('POST', '/api/search', { who: 'ann', body: detailed });
    assert.equal(again.data.started, false);
    await waitUntilIdle('ann');
    assert.equal((await call('GET', '/api/history', { who: 'ann' })).data.searches.length, before + 1);
  });

  it('does not record a search that failed validation', async () => {
    const before = (await call('GET', '/api/history', { who: 'ann' })).data.searches.length;
    assert.equal((await call('POST', '/api/search', { who: 'ann', body: { db_bench: 'B' } })).status, 422);
    assert.equal((await call('GET', '/api/history', { who: 'ann' })).data.searches.length, before);
  });
});

describe('people cannot see or touch each other\'s data', () => {
  it('history, logs, status, results and downloads are private', async () => {
    const annHistory = (await call('GET', '/api/history', { who: 'ann' })).data.searches;
    assert.ok(annHistory.length >= 4);
    assert.deepEqual((await call('GET', '/api/history', { who: 'bob' })).data.searches, []);

    // Bob can't delete Ann's search
    assert.equal((await call('DELETE', `/api/history/${annHistory[0].id}`, { who: 'bob' })).status, 404);
    assert.ok((await call('GET', '/api/history', { who: 'ann' })).data.searches.some((s) => s.id === annHistory[0].id));

    // Bob has no log, no result, no "last job"
    assert.deepEqual((await call('GET', '/api/logs/search', { who: 'bob' })).data.entries, []);
    assert.ok((await call('GET', '/api/logs/search', { who: 'ann' })).data.entries.length > 0);
    assert.equal((await call('GET', '/api/search/result', { who: 'bob' })).status, 404);
    assert.equal((await call('GET', '/api/search/status', { who: 'bob' })).data.last_job, null);

    // Ann can download her workbook; Bob can't, even knowing its name
    assert.equal((await call('GET', '/outputs/mine.xlsx', { who: 'ann' })).status, 200);
    assert.equal((await call('GET', '/outputs/mine.xlsx', { who: 'bob' })).status, 404);
  });

  it('someone else\'s running search is invisible and cannot be stopped', async () => {
    await call('POST', '/api/search', { who: 'ann', body: detailed });
    const bobStatus = (await call('GET', '/api/search/status', { who: 'bob' })).data;
    assert.deepEqual([bobStatus.is_running, bobStatus.mine, bobStatus.kind, bobStatus.job_id], [true, false, null, null]);
    assert.equal((await call('POST', '/api/search/stop', { who: 'bob' })).data.stopped, false);
    const refused = await call('POST', '/api/search', { who: 'bob', body: detailed });
    assert.match(refused.data.message, /someone else/);
    await waitUntilIdle('ann');
    assert.deepEqual((await call('GET', '/api/history', { who: 'bob' })).data.searches, []); // refused search left no trace
  });
});

describe('managing history and signing out', () => {
  it('deletes one search, then clears the rest', async () => {
    const list = (await call('GET', '/api/history', { who: 'ann' })).data.searches;
    assert.equal((await call('DELETE', `/api/history/${list[0].id}`, { who: 'ann' })).data.deleted, true);
    assert.equal((await call('DELETE', '/api/history/abc', { who: 'ann' })).status, 404);
    assert.equal((await call('GET', '/api/history', { who: 'ann' })).data.searches.length, list.length - 1);
    assert.equal((await call('DELETE', '/api/history', { who: 'ann' })).data.deleted, list.length - 1);
    assert.deepEqual((await call('GET', '/api/history', { who: 'ann' })).data.searches, []);
  });

  it('signing out ends the session', async () => {
    const out = await call('POST', '/api/auth/logout', { who: 'ann' });
    assert.equal(out.status, 200);
    assert.match(out.res.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await call('GET', '/api/form-options', { who: 'ann' })).status, 401); // the old cookie is dead server-side
    assert.equal((await call('GET', '/api/auth/me', { who: 'ann' })).data.user, null);
  });
});

describe('live updates over the WebSocket', () => {
  it('require sign-in and deliver a search\'s events only to its owner', async () => {
    const { default: WebSocket } = await import('ws');
    const { attachWebSocket } = await import('../src/ws.js');
    const auth = createAuth({ store, verify, allowedEmails: ['ann@example.com', 'bob@example.com'], clientId: 'c' });
    const http = await import('node:http');
    const srv = http.createServer(createApp(jm, { store, auth, outputDir: path.join(dir, 'out'), clientDist: path.join(dir, 'dist') }));
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const live = attachWebSocket(srv, { auth, jobManager: jm });
    const wsUrl = `ws://127.0.0.1:${srv.address().port}/ws/logs`;
    const sockets = [];
    try {
      // signed-out, forged-origin and wrong-path connections are refused
      const refused = (opts, url = wsUrl) => new Promise((resolve) => {
        const s = new WebSocket(url, opts);
        s.on('unexpected-response', (_q, res) => resolve(res.statusCode));
        s.on('open', () => { sockets.push(s); resolve('open'); });
        s.on('error', () => {});
      });
      assert.equal(await refused({}), 401);
      await signIn('ann', `ann${LONG}`); await signIn('bob', `bob${LONG}`);
      assert.equal(await refused({ headers: { Cookie: jar.ann, Origin: 'http://evil.example' } }), 403);
      assert.equal(await refused({ headers: { Cookie: jar.ann } }, wsUrl.replace('/ws/logs', '/other')), 404);

      const open = (who) => new Promise((resolve) => {
        const received = [];
        const s = new WebSocket(wsUrl, { headers: { Cookie: jar[who] } });
        s.on('message', (d) => received.push(JSON.parse(d)));
        s.on('open', () => { sockets.push(s); resolve(received); });
      });
      const annSees = await open('ann');
      const bobSees = await open('bob');

      assert.equal((await call('POST', '/api/search', { who: 'ann', body: detailed })).data.started, true);
      await waitUntilIdle('ann');
      await new Promise((r) => setTimeout(r, 100));

      assert.ok(annSees.some((m) => m.type === 'done'), 'owner gets the result');
      assert.ok(annSees.some((m) => m.type === 'log'));
      assert.equal(annSees.find((m) => m.type === 'done').owner, undefined, 'the owner field is internal');
      assert.deepEqual(bobSees, [], 'nobody else receives anything');
    } finally {
      sockets.forEach((s) => s.terminate());
      live.close();
      srv.close();
    }
  });
});
