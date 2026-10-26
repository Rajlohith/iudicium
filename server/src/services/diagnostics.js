/**
 * Can the scraper run on this machine?
 *
 * Runs `python -m scraper.check_env` and turns the answer into a list of
 * plain-language problems. The API calls it before starting a search, so a
 * broken Python/Playwright/Tesseract setup is reported in the response to
 * the button press itself, not discovered later as a silent failure.
 */

import { spawn } from 'node:child_process';

import { PROJECT_ROOT, PYTHON_BIN, SCRAPER_MOCK, TESSERACT_CMD } from '../config.js';

const CACHE_MS = 60_000;
const TIMEOUT_MS = 30_000;

let cached = null; // { at, report } -- only successful reports are kept

/** Run the checker; resolves with a report object, never rejects. */
export function runCheck({ pythonBin = PYTHON_BIN, tesseractCmd = TESSERACT_CMD, cwd = PROJECT_ROOT, args = ['-m', 'scraper.check_env'] } = {}) {
  return new Promise((resolve) => {
    const fail = (problem, extra = {}) =>
      resolve({ ok: false, python: pythonBin, problems: [problem], ...extra });

    let child;
    try {
      child = spawn(pythonBin, [...args, tesseractCmd ?? ''], {
        cwd,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      fail(`Could not start Python ("${pythonBin}"): ${err.message}`);
      return;
    }

    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      fail(`The Python environment check did not finish within ${TIMEOUT_MS / 1000}s ("${pythonBin}").`);
    }, TIMEOUT_MS);

    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => {
      clearTimeout(timer);
      fail(
        e.code === 'ENOENT'
          ? `Python was not found ("${pythonBin}"). Install Python 3.11+ or set PYTHON_BIN in .env to the full path of python.exe.`
          : `Could not start Python ("${pythonBin}"): ${e.message}`,
      );
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const lastLine = out.trim().split('\n').pop();
      try {
        resolve(JSON.parse(lastLine));
      } catch {
        const detail = (err.trim().split('\n').slice(-3).join(' | ') || out.trim() || `exit code ${code}`).slice(0, 400);
        fail(`Python ("${pythonBin}") could not run the scraper check: ${detail}`);
      }
    });
  });
}

/** Cached for a minute when healthy; always re-run after a failure so a fix is picked up immediately. */
export async function checkScraperEnvironment({ force = false } = {}) {
  if (SCRAPER_MOCK) return { ok: true, mock: true, problems: [] };
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.report;
  const report = await runCheck();
  cached = report.ok ? { at: Date.now(), report } : null;
  return report;
}

/** null when the scraper can run, otherwise one readable sentence for the UI. */
export async function preflightProblem() {
  const report = await checkScraperEnvironment();
  return report.ok ? null : `The scraper can't start. ${report.problems.join(' ')}`;
}
