import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { JobManager, serializeCases } from '../src/services/jobManager.js';

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fakeWorker.mjs');
let dir;
before(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'iud-jm-')); });
after(() => rm(dir, { recursive: true, force: true }));

function makeManager(behaviour = 'ok', extra = {}) {
  const written = [];
  const jm = new JobManager({
    workerCommand: (mode, specPath) => ({ cmd: process.execPath, args: [fake, mode, specPath] }),
    env: { FAKE_BEHAVIOUR: behaviour },
    outputDir: path.join(dir, 'out'), pdfDir: path.join(dir, 'out', 'pdfs'), tmpDir: path.join(dir, 'tmp'), debugDir: path.join(dir, 'dbg'),
    writeWorkbook: async (file, cases) => { written.push({ file, n: cases.length }); },
    ...extra,
  });
  const events = [];
  jm.on('message', (m) => events.push(m));
  const finished = () => new Promise((resolve) => jm.on('message', (m) => { if (m.type === 'done' || m.type === 'error') resolve(m); }));
  return { jm, events, written, finished };
}

const U1 = { userId: 1, historyId: null };
const criteria = { db_bench: 'B', from_date: '01-01-2024', to_date: '02-01-2024', output_filename: 'run' };

describe('JobManager', () => {
  it('runs a job end to end and reports the result', async () => {
    const { jm, events, written, finished } = makeManager();
    const done = finished();
    assert.deepEqual(jm.startDetailed(criteria, U1), { started: true, message: 'Search started.' });
    const end = await done;
    assert.equal(end.type, 'done');
    assert.equal(end.payload.case_count, 20);
    assert.equal(end.payload.kind, 'detailed');
    assert.equal(end.job, 1);
    const status = jm.statusFor(1);
    assert.deepEqual({ ...status.last_job, ended_at: 0, ended_ago_ms: 0 }, { id: 1, kind: 'detailed', state: 'done', message: null, ended_at: 0, ended_ago_ms: 0 });
    assert.equal(jm.lastResultFor(1).case_count, 20);
    assert.equal(status.job_id, null);
    assert.equal(end.owner, 1);
    assert.equal(end.payload.output_filename, 'run.xlsx');
    assert.equal(end.payload.cases[0].petitioner, 'A');
    assert.equal(end.payload.cases[0].respondent, 'B');
    assert.equal(written[0].n, 20);
    assert.ok(events.some((e) => e.type === 'case_progress'));
    assert.equal(jm.isRunning, false);
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(await readdir(path.join(dir, 'tmp')), []); // spec, stop and result files cleaned up
    assert.ok(jm.getLog(1, 'search').some((l) => l.text === 'started'));
    jm.clearLog(1, 'search');
    assert.equal(jm.getLog(1, 'search').length, 0);
  });

  it('allows only one job at a time', async () => {
    const { jm, finished } = makeManager();
    let done = finished();
    assert.equal(jm.startDetailed(criteria, U1).started, true);
    assert.equal(jm.runningKind, 'detailed');
    assert.equal(jm.startQuick({ db_bench: 'B', case_type: '144', case_no: '1', case_year: '2023' }, U1).started, false);
    await done;
    done = finished();
    assert.equal(jm.startDetailed(criteria, U1).started, true); // free again
    await done;
  });

  it('stops cooperatively and keeps partial results', async () => {
    const { jm, finished } = makeManager();
    const done = finished();
    jm.startDetailed(criteria, U1);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(jm.requestStop(1), true);
    const end = await done;
    assert.equal(end.type, 'done');
    assert.equal(end.payload.cancelled, true);
    assert.ok(end.payload.case_count > 0 && end.payload.case_count < 20);
    assert.equal(jm.requestStop(1), false); // nothing running
  });

  it('kills a scraper that ignores the stop request after the grace period', async () => {
    const { jm, events, finished } = makeManager('hang', { stopGraceMs: 300 });
    const done = finished();
    jm.startDetailed(criteria, U1);
    await new Promise((r) => setTimeout(r, 300));
    jm.requestStop(1);
    const end = await done;
    assert.equal(end.type, 'error');
    assert.match(end.payload, /stopped before it finished/);
    assert.ok(events.some((e) => e.type === 'log' && /terminating it/.test(e.payload)));
    assert.equal(jm.isRunning, false);
  });

  it('reports worker errors and crashes readably, then frees the manager', async () => {
    let m = makeManager('error');
    let done = m.finished();
    m.jm.startDetailed(criteria, U1);
    assert.equal((await done).payload, 'site unreachable');
    assert.equal(m.jm.statusFor(1).last_job.state, 'error');
    assert.equal(m.jm.statusFor(1).last_job.message, 'site unreachable');
    assert.equal(m.jm.isRunning, false);

    m = makeManager('crash');
    done = m.finished();
    m.jm.startDetailed(criteria, U1);
    const end = await done;
    assert.equal(end.type, 'error');
    assert.match(end.payload, /No module named 'playwright'.*pip install -r requirements\.txt/);
    assert.ok(m.jm.getLog(1, 'search').some((l) => l.isErr && l.text.startsWith('ERROR: ')));
  });

  it('explains a missing Python executable', async () => {
    const { jm, finished } = makeManager('ok', { workerCommand: () => ({ cmd: 'definitely-not-python', args: [] }) });
    const done = finished();
    jm.startDetailed(criteria, U1);
    assert.match((await done).payload, /"definitely-not-python" was not found.*PYTHON_BIN/);
  });

  it('keeps people apart: logs, results, stop rights, output folders and the finished event', async () => {
    const { jm, written, finished } = makeManager();
    const U2 = { userId: 2, historyId: 77 };
    const events = [];
    jm.on('finished', (e) => events.push(e));
    const done = finished();
    assert.equal(jm.startDetailed(criteria, U2).started, true);

    // someone else's search is running: user 1 is told so, can't stop it, and sees nothing of it
    assert.match(jm.startDetailed(criteria, U1).message, /someone else/);
    assert.equal(jm.requestStop(1), false);
    assert.deepEqual(jm.statusFor(1), { is_running: true, mine: false, kind: null, job_id: null, last_job: null });
    assert.equal(jm.statusFor(2).mine, true);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(jm.getLog(1, 'search').length, 0);
    assert.ok(jm.getLog(2, 'search').length > 0);

    const end = await done;
    assert.equal(end.owner, 2);
    assert.equal(jm.lastResultFor(1), null);
    assert.equal(jm.lastResultFor(2).case_count, 20);
    assert.ok(written[0].file.includes(path.join('users', '2')));
    assert.deepEqual(events.map((e) => ({ userId: e.userId, historyId: e.historyId, status: e.status, caseCount: e.caseCount })), [
      { userId: 2, historyId: 77, status: 'done', caseCount: 20 },
    ]);
  });

  it('reports a stopped search as cancelled and a crashed one as failed in the finished event', async () => {
    let m = makeManager();
    const seen = [];
    m.jm.on('finished', (e) => seen.push(e.status));
    let done = m.finished();
    m.jm.startDetailed(criteria, U1);
    await new Promise((r) => setTimeout(r, 300));
    m.jm.requestStop(1);
    await done;
    m = makeManager('error');
    m.jm.on('finished', (e) => seen.push(e.status));
    done = m.finished();
    m.jm.startDetailed(criteria, U1);
    await done;
    assert.deepEqual(seen, ['cancelled', 'failed']);
  });

  it('looks up judges without taking the job lock, and caches the answer', async () => {
    const { jm } = makeManager();
    assert.deepEqual(await jm.fetchJudges('B'), [{ value: '1', label: 'JUSTICE X' }]);
    assert.equal(jm.isRunning, false);
    jm.opts.workerCommand = () => ({ cmd: 'definitely-not-python', args: [] });
    assert.equal((await jm.fetchJudges('B')).length, 1); // served from cache
    await assert.rejects(jm.fetchJudges('D'), /not found/);
  });
});

describe('serializeCases', () => {
  it('pulls identity and parties out of the raw scraper case', () => {
    const [c] = serializeCases([{ base_row: { 'Case Type': 'WP', 'Case No': '9', 'Case Year': '2020', 'Petitioner V/S Respondent Name': 'X v/s Y' }, case_info_text: 'info', sections_data: { S: 't' } }]);
    assert.deepEqual([c.case_type, c.case_no, c.case_year, c.petitioner, c.respondent, c.case_information], ['WP', '9', '2020', 'X', 'Y', 'info']);
    assert.deepEqual(c.sections, { S: 't' });
    assert.equal(c.judgment_pdf, null);
  });
});
