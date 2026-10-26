/**
 * Runs scraper jobs in the Python worker (scraper/worker.py) and turns
 * what comes back into the workbook and the payload the UI renders.
 *
 *   Node (this file)                       Python worker
 *   ----------------                       -------------
 *   write  <job>.job.json (the spec)
 *   spawn  python -m scraper.worker <mode> <job>.job.json   runs Playwright + Tesseract
 *   stdout <- JSON-lines events  <--------  log / progress / case_progress / result / error
 *   create <job>.job.json.stop  --------->  winds down, saves what it has
 *   read result file, write .xlsx (ExcelJS), zip with PDFs, tell the UI
 *
 * Only one search runs at a time. That matches driving a single browser
 * session and keeps one Chromium instance from being launched several
 * times concurrently on the server.
 *
 * Emits 'message' events ({ type, payload }); the WebSocket layer
 * forwards them to every connected browser. Types: log, error, progress,
 * case_progress, done.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';

import {
  DEBUG_DIR,
  DEFAULT_OUTPUT_FILENAME,
  OUTPUT_DIR,
  PROJECT_ROOT,
  PYTHON_BIN,
  SCRAPER_HEADLESS,
  STOP_GRACE_MS,
  TESSERACT_CMD,
  TMP_DIR,
} from '../config.js';
import { sanitizeFilenamePart, splitPartyNames } from '../utils/text.js';
import { bundleOutput } from './bundle.js';
import { writeCombinedWorkbook } from './excelWriter.js';
import { BENCH_NAMES } from './reference.js';

const MAX_LOG_ENTRIES = 1000;
const JUDGE_CACHE_TTL_MS = 30 * 60 * 1000;
const JUDGE_LOOKUP_TIMEOUT_MS = 120_000;
const STDERR_TAIL_LINES = 30;
const STDERR_TO_UI_LINES = 15; // how many raw Python stderr lines are echoed into the activity log
const SILENCE_NOTICE_MS = 20_000; // tell the person if the worker says nothing for this long

const INSTALL_HINT = 'Run `pip install -r requirements.txt` and `playwright install chromium`, and install Tesseract OCR.';

// ----------------------------------------------------------------------
// Pure helpers (exported for tests)
// ----------------------------------------------------------------------

/** "my results" -> "my results.xlsx"; unsafe characters become "-". */
export function resolveOutputFilename(requested) {
  const name = String(requested ?? '').trim() || DEFAULT_OUTPUT_FILENAME;
  return `${sanitizeFilenamePart(name.replace(/\.xlsx$/i, ''))}.xlsx`;
}

/**
 * Turn the scraper's raw case list into something the frontend can
 * render directly: identity fields pulled out, plus every expandable
 * section (Party Information, Daily Orders, Documents, Fees, etc.).
 */
/** Each person's workbooks, zips and judgment PDFs live in their own folder. */
export function userOutputDir(outputDir, userId) {
  return path.join(outputDir, 'users', String(userId));
}

export function serializeCases(cases) {
  return cases.map((c) => {
    const baseRow = c.base_row ?? {};
    const [petitioner, respondent] = splitPartyNames(baseRow['Petitioner V/S Respondent Name'] ?? '');
    return {
      case_type: baseRow['Case Type'] ?? '',
      case_no: baseRow['Case No'] ?? '',
      case_year: baseRow['Case Year'] ?? '',
      petitioner,
      respondent,
      base_row: baseRow,
      case_information: c.case_info_text ?? '',
      case_info_structured: c.case_info_structured ?? null,
      sections: c.sections_data ?? {},
      sections_structured: c.sections_structured ?? {},
      judgment_pdf: c.judgment_pdf ?? null,
    };
  });
}

/** Kill a process and everything it started (Playwright's browser, etc.). */
function killTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(-child.pid, 'SIGKILL'); // the worker leads its own process group (see spawn below)
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

function describeSpawnError(err, cmd) {
  if (err?.code === 'ENOENT') {
    return `Could not start the Python scraper ("${cmd}" was not found). Install Python 3.11+ or set PYTHON_BIN in .env. ${INSTALL_HINT}`;
  }
  return `Could not start the Python scraper: ${err?.message ?? err}`;
}

function withInstallHint(message) {
  return /No module named|ModuleNotFoundError|Executable doesn't exist|tesseract is not installed/i.test(message)
    ? `${message} — ${INSTALL_HINT}`
    : message;
}

// ----------------------------------------------------------------------
// Job manager
// ----------------------------------------------------------------------

export class JobManager extends EventEmitter {
  #running = false;
  #jobType = null; // 'search' | 'case_number' -- which page's log buffer is active
  #child = null;
  #stopFile = null;
  #stopRequested = false;
  #stopTimer = null;
  #children = new Set(); // every live worker, including judge lookups
  #logBuffers = new Map(); // userId -> { search: [], case_number: [] }
  #judgeCache = new Map();
  #jobSeq = 0;
  #jobId = null;
  #ownerId = null; // who started the running job
  #historyId = null; // the saved-search record the running job belongs to
  #lastJobs = new Map(); // userId -> { id, kind, state: 'done' | 'error', message, ended_at } -- lets a client that missed the WebSocket catch up
  #lastResults = new Map(); // userId -> that person's most recent `done` payload

  constructor(options = {}) {
    super();
    this.opts = {
      workerCommand: (mode, specPath) => ({ cmd: PYTHON_BIN, args: ['-u', '-m', 'scraper.worker', mode, specPath] }),
      cwd: PROJECT_ROOT,
      outputDir: OUTPUT_DIR,
      tmpDir: TMP_DIR,
      debugDir: DEBUG_DIR,
      tesseractCmd: TESSERACT_CMD,
      headless: SCRAPER_HEADLESS,
      stopGraceMs: STOP_GRACE_MS,
      writeWorkbook: writeCombinedWorkbook,
      env: {},
      ...options,
    };
  }

  get isRunning() {
    return this.#running;
  }

  /** What one person is allowed to know about the (single, shared) scraper right now. */
  statusFor(userId) {
    const mine = this.#running && this.#ownerId === userId;
    const last = this.#lastJobs.get(userId) ?? null;
    return {
      is_running: this.#running,
      mine,
      kind: mine ? this.runningKind : null,
      job_id: mine ? this.#jobId : null,
      last_job: last && { ...last, ended_ago_ms: Date.now() - last.ended_at },
    };
  }

  lastResultFor(userId) {
    return this.#lastResults.get(userId) ?? null;
  }

  /** 'detailed' | 'quick' while a job runs, otherwise null. */
  get runningKind() {
    if (!this.#running) return null;
    return this.#jobType === 'case_number' ? 'quick' : 'detailed';
  }

  // -- per-page activity-log buffers (survive page reloads) ---------------

  #bufferFor(userId) {
    if (!this.#logBuffers.has(userId)) this.#logBuffers.set(userId, { search: [], case_number: [] });
    return this.#logBuffers.get(userId);
  }

  getLog(userId, page) {
    return [...(this.#bufferFor(userId)[page] ?? [])];
  }

  clearLog(userId, page) {
    const buffers = this.#bufferFor(userId);
    if (page in buffers) buffers[page] = [];
  }

  #storeLog(type, payload) {
    if (!this.#jobType || this.#ownerId == null) return;
    const isErr = type === 'error';
    const now = new Date();
    const ts = [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
    const buffers = this.#bufferFor(this.#ownerId);
    const buf = buffers[this.#jobType];
    buf.push({ text: isErr ? `ERROR: ${payload}` : payload, isErr, ts });
    if (buf.length > MAX_LOG_ENTRIES) buffers[this.#jobType] = buf.slice(-MAX_LOG_ENTRIES);
  }

  #broadcast(type, payload) {
    if (type === 'log' || type === 'error') this.#storeLog(type, payload);
    this.emit('message', { type, payload, job: this.#jobId, owner: this.#ownerId });
  }

  // -- job lifecycle -------------------------------------------------------

  /** `who` = { userId, historyId? }: whose search this is, and which saved-search record it updates. */
  startDetailed(criteria, who) {
    return this.#start('detailed', criteria, who);
  }

  startQuick(criteria, who) {
    return this.#start('quick', criteria, who);
  }

  #start(kind, criteria, who) {
    if (who?.userId == null) throw new Error('startDetailed/startQuick need { userId }.');
    if (this.#running) {
      return {
        started: false,
        message:
          this.#ownerId === who.userId
            ? 'A search is already running. Stop it first.'
            : 'Another search (started by someone else) is running right now. Please try again in a moment.',
      };
    }
    this.#running = true;
    this.#stopRequested = false;
    this.#ownerId = who.userId;
    this.#historyId = who.historyId ?? null;
    this.#jobId = ++this.#jobSeq;
    this.#jobType = kind === 'quick' ? 'case_number' : 'search';

    this.#run(kind, criteria).catch((err) => this.#finish('error', err?.message ?? String(err)));
    return { started: true, message: 'Search started.' };
  }

  /** Ask the running scraper to wind down; it saves what it has collected so far. */
  requestStop(userId) {
    if (!this.#child || this.#ownerId !== userId) return false;
    if (!this.#stopRequested) {
      this.#stopRequested = true;
      try {
        if (this.#stopFile) writeFileSync(this.#stopFile, 'stop');
      } catch {
        /* the worker already exited */
      }
      // A scraper stuck waiting on the site never sees the polite request.
      const child = this.#child;
      this.#stopTimer = setTimeout(() => {
        this.#broadcast('log', `The scraper did not stop within ${Math.round(this.opts.stopGraceMs / 1000)}s; terminating it.`);
        killTree(child);
      }, this.opts.stopGraceMs);
      this.#stopTimer.unref();
    }
    return true;
  }

  /** Kill every worker (server shutting down). */
  shutdown() {
    for (const child of this.#children) killTree(child);
  }

  /** Broadcast the final message, then free the manager -- in one tick, so no new job can sneak in between. */
  #finish(type, payload) {
    const kind = this.#jobType === 'case_number' ? 'quick' : 'detailed';
    const owner = this.#ownerId;
    const historyId = this.#historyId;
    this.#lastJobs.set(owner, { id: this.#jobId, kind, state: type === 'done' ? 'done' : 'error', message: type === 'done' ? null : String(payload), ended_at: Date.now() });
    if (type === 'done') this.#lastResults.set(owner, payload);
    this.#broadcast(type, payload);
    this.emit('finished', {
      userId: owner,
      historyId,
      kind,
      status: type === 'error' ? 'failed' : payload.cancelled ? 'cancelled' : 'done',
      caseCount: type === 'done' ? payload.case_count : null,
      error: type === 'error' ? String(payload) : null,
    });
    this.#running = false;
    this.#ownerId = null;
    this.#historyId = null;
    this.#jobType = null;
    this.#child = null;
    this.#stopRequested = false;
    clearTimeout(this.#stopTimer);
    this.#stopTimer = null;
  }

  async #run(kind, criteria) {
    const log = (message) => this.#broadcast('log', message);
    const resultPath = path.join(this.opts.tmpDir, `${randomUUID()}.json`);
    const userDir = userOutputDir(this.opts.outputDir, this.#ownerId);
    const pdfDir = path.join(userDir, 'pdfs');

    try {
      await Promise.all([this.opts.tmpDir, userDir, pdfDir].map((d) => mkdir(d, { recursive: true })));

      log(`Starting the scraper (${this.opts.workerCommand('detailed', '').cmd})...`);

      const spec = {
        ...criteria,
        bench_name: BENCH_NAMES[criteria.db_bench] ?? criteria.db_bench,
        pdf_dir: pdfDir,
        debug_dir: this.opts.debugDir,
        result_path: resultPath,
        tesseract_cmd: this.opts.tesseractCmd,
        headless: this.opts.headless,
      };

      const result = await this.#runWorker(kind, spec, { forward: true, track: true });
      const cases = JSON.parse(await readFile(resultPath, 'utf8'));
      await rm(resultPath, { force: true }); // handed over; the finally block below only covers failure paths

      const filename = resolveOutputFilename(criteria.output_filename);
      const xlsxPath = path.join(userDir, filename);
      await this.opts.writeWorkbook(xlsxPath, cases);
      log(
        kind === 'quick'
          ? `Wrote ${filename} with ${cases.length} case sheet(s).`
          : `Wrote ${filename} with ${cases.length} unique case sheet(s). Duplicates skipped: ${result.duplicates_skipped}.`,
      );

      const finalPath = await bundleOutput(xlsxPath, cases, { pdfDir, log });

      this.#finish('done', {
        kind,
        output_filename: path.basename(finalPath),
        case_count: result.case_count,
        duplicates_skipped: result.duplicates_skipped,
        cancelled: result.cancelled,
        cases: serializeCases(cases),
      });
    } catch (err) {
      this.#finish('error', err?.message ?? String(err));
    } finally {
      rm(resultPath, { force: true }).catch(() => {});
    }
  }

  /**
   * Run the worker for one job and resolve with its `result` payload.
   * Rejects with a readable message if it fails to start, reports an
   * error, or exits without a result.
   *
   * forward: relay the worker's log/progress events to the browser.
   * track:   remember the child so requestStop() can reach it.
   */
  async #runWorker(mode, spec, { forward = false, track = false, timeoutMs = 0 } = {}) {
    const specPath = path.join(this.opts.tmpDir, `${randomUUID()}.job.json`);
    const stopFile = `${specPath}.stop`;
    await mkdir(this.opts.tmpDir, { recursive: true });
    await writeFile(specPath, JSON.stringify({ ...spec, stop_file: stopFile, parent_pid: process.pid }), 'utf8');
    if (track) this.#stopFile = stopFile;
    try {
      return await this.#spawnWorker(mode, specPath, { forward, track, timeoutMs });
    } finally {
      if (track) this.#stopFile = null;
      rm(specPath, { force: true }).catch(() => {});
      rm(stopFile, { force: true }).catch(() => {});
    }
  }

  #spawnWorker(mode, specPath, { forward, track, timeoutMs }) {
    return new Promise((resolve, reject) => {
      const { cmd, args } = this.opts.workerCommand(mode, specPath);
      let settled = false;
      let silenceTimer = null;
      let timer = null;
      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(silenceTimer);
        fn(value);
      };

      let child;
      try {
        child = spawn(cmd, args, {
          cwd: this.opts.cwd,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', ...this.opts.env },
          stdio: ['ignore', 'pipe', 'pipe'], // the worker takes its job from a file; nothing is sent on stdin
          detached: process.platform !== 'win32', // own process group, so killTree can reach the browser too
          windowsHide: true,
        });
      } catch (err) {
        reject(new Error(describeSpawnError(err, cmd)));
        return;
      }

      this.#children.add(child);
      if (track) this.#child = child;

      let result = null;
      let workerError = null;
      let stderrToUi = 0;
      const stderrTail = [];

      if (timeoutMs) {
        timer = setTimeout(() => {
          killTree(child);
          settle(reject, new Error(`The scraper did not respond within ${Math.round(timeoutMs / 1000)}s.`));
        }, timeoutMs);
      }

      // If the worker stays completely silent, say so instead of leaving the page on "Starting...".
      const armSilenceNotice = () => {
        if (!forward) return;
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
          this.#broadcast(
            'log',
            `Still waiting for the scraper (${cmd}) to report in after ${SILENCE_NOTICE_MS / 1000}s. The first browser launch can be slow; ` +
              'if this keeps going, look at the terminal where the server is running, or open /api/diagnostics.',
          );
        }, SILENCE_NOTICE_MS);
        silenceTimer.unref();
      };
      armSilenceNotice();

      child.on('error', (err) => settle(reject, new Error(describeSpawnError(err, cmd))));

      createInterface({ input: child.stdout }).on('line', (line) => {
        if (!line.trim()) return;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          stderrTail.push(line); // not protocol -- keep it for the error message
          return;
        }
        armSilenceNotice();
        switch (event.type) {
          case 'log':
          case 'progress':
          case 'case_progress':
            if (forward) this.#broadcast(event.type, event.payload);
            break;
          case 'result':
            result = event.payload;
            break;
          case 'error':
            workerError = String(event.payload);
            break;
          default:
            break;
        }
      });

      createInterface({ input: child.stderr }).on('line', (line) => {
        if (!line.trim()) return;
        stderrTail.push(line);
        if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
        console.error(`[scraper] ${line}`);
        if (forward && stderrToUi < STDERR_TO_UI_LINES) {
          stderrToUi += 1;
          this.#broadcast('log', `[python] ${line.slice(0, 300)}`);
        }
      });

      child.on('close', (code, signal) => {
        this.#children.delete(child);
        if (result && code === 0) {
          settle(resolve, result);
          return;
        }
        let message;
        if (workerError) message = workerError;
        else if (this.#stopRequested && track) message = 'The search was stopped before it finished, so no results were saved.';
        else if (stderrTail.length) message = stderrTail.slice(-3).join(' | ');
        else message = `The scraper exited unexpectedly (${signal ? `signal ${signal}` : `code ${code}`}).`;
        settle(reject, new Error(withInstallHint(message)));
      });
    });
  }

  // -- judge lookup ---------------------------------------------------------

  /** Live Judge / Author Judge options for a bench (cached for a while: the list rarely changes). */
  async fetchJudges(bench) {
    const cached = this.#judgeCache.get(bench);
    if (cached && Date.now() - cached.at < JUDGE_CACHE_TTL_MS) return cached.judges;

    const result = await this.#runWorker(
      'judges',
      { db_bench: bench, headless: this.opts.headless },
      { timeoutMs: JUDGE_LOOKUP_TIMEOUT_MS },
    );
    const judges = Array.isArray(result.judges) ? result.judges : [];
    if (judges.length) this.#judgeCache.set(bench, { at: Date.now(), judges });
    return judges;
  }
}

export const jobManager = new JobManager();
