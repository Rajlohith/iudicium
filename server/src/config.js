/**
 * Central configuration for the Iudicium server.
 *
 * Form data (case types, years, coram, sections, ...) comes from
 * shared/config.json -- the same file the Python scraper reads -- so the
 * two sides can never drift apart. Everything environment-specific comes
 * from .env / process.env.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(here, '..', '..');

// .env lives at the project root, whatever directory the server is started from.
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const shared = JSON.parse(
  readFileSync(process.env.IUDICIUM_CONFIG || path.join(PROJECT_ROOT, 'shared', 'config.json'), 'utf8'),
);

// ----------------------------------------------------------------------
// Form reference data (shared with the scraper)
// ----------------------------------------------------------------------

export const BENCH_OPTIONS = shared.benchOptions; // { "Principal Bench": "B", ... }
export const CORAM_OPTIONS = shared.coramOptions; // { "Single Bench": "1", ... }
export const REPORT_TYPE_OPTIONS = shared.reportTypeOptions; // { None: "none", Reported: "Y", ... }
export const CASE_TYPES = shared.caseTypes; // [{ value, label }]
export const CASE_YEARS = shared.caseYears; // [2026, 2025, ...]
export const SECTION_ORDER = shared.sectionOrder; // [{ id, name }]
export const DEFAULT_OUTPUT_FILENAME = shared.defaultOutputFilename;
export const NO_DATA_MARKERS = new Set(shared.noDataMarkers);

// "Case Information" and "Judgment PDF" are pseudo-sections the UI lets
// people include/exclude alongside the real case-detail sections.
export const SECTION_NAMES = ['Case Information', 'Judgment PDF', ...SECTION_ORDER.map((s) => s.name)];

// ----------------------------------------------------------------------
// Environment
// ----------------------------------------------------------------------

const bool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return String(value).trim().toLowerCase() !== 'false';
};

const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

export const HOST = process.env.HOST || '127.0.0.1';
export const PORT = int(process.env.PORT, 8000);

export const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(PROJECT_ROOT, 'outputs'));
export const TMP_DIR = path.join(OUTPUT_DIR, '.tmp');
export const DEBUG_DIR = path.join(OUTPUT_DIR, 'debug');

export const CLIENT_DIST = path.join(PROJECT_ROOT, 'client', 'dist');

/**
 * Which Python runs the scraper. In order: PYTHON_BIN from .env, the active
 * virtual environment, a .venv/venv folder in the project, then plain
 * `python` (Windows) / `python3`. The scraper's packages are normally
 * installed in a virtual environment, so picking it up automatically avoids
 * the classic "works in my terminal, not from the server" problem.
 */
function findPython() {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
  const win = process.platform === 'win32';
  const rel = win ? ['Scripts', 'python.exe'] : ['bin', 'python'];
  const candidates = [];
  if (process.env.VIRTUAL_ENV) candidates.push(path.join(process.env.VIRTUAL_ENV, ...rel));
  for (const dir of ['.venv', 'venv', 'env']) candidates.push(path.join(PROJECT_ROOT, dir, ...rel));
  return candidates.find((c) => existsSync(c)) ?? (win ? 'python' : 'python3');
}

export const PYTHON_BIN = findPython();
export const TESSERACT_CMD = process.env.TESSERACT_CMD || null;
export const SCRAPER_HEADLESS = bool(process.env.SCRAPER_HEADLESS, true);
// Same rule as the Python worker: only the exact string "true" turns mock mode on.
export const SCRAPER_MOCK = String(process.env.SCRAPER_MOCK ?? '').trim().toLowerCase() === 'true';

// After a stop request, how long the scraper gets to wind down on its own
// before it is killed outright (it can be stuck waiting on the site).
export const STOP_GRACE_MS = int(process.env.STOP_GRACE_MS, 60_000);

export const LLM = {
  provider: (process.env.LLM_PROVIDER || 'gemini').trim().toLowerCase(),
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
  },
  timeoutMs: 120_000,
};

// ----------------------------------------------------------------------
// Accounts and the database
// ----------------------------------------------------------------------

/** The "Web application" OAuth client ID from Google Cloud Console (not a secret). */
export const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();

/** SQLite file holding accounts, sessions and each person's search history. */
export const DATABASE_PATH = path.resolve(process.env.DATABASE_PATH || path.join(PROJECT_ROOT, 'data', 'iudicium.db'));

export const SESSION_DAYS = int(process.env.SESSION_DAYS, 7);

/** Set to "true" when running behind a reverse proxy / load balancer (Cloud Run) so HTTPS is detected correctly. */
export const TRUST_PROXY = String(process.env.TRUST_PROXY ?? '').trim().toLowerCase() === 'true';
