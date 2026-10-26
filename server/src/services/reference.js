/**
 * Lookup tables and small validators derived from shared/config.json.
 * Used by the assistant (to validate what the model proposes) and by the
 * API layer (to validate what the browser submits), so both apply exactly
 * the same rules.
 */

import { BENCH_OPTIONS, CASE_TYPES, CASE_YEARS, CORAM_OPTIONS, REPORT_TYPE_OPTIONS } from '../config.js';

export const BENCH_CODES = new Set(Object.values(BENCH_OPTIONS)); // B, D, K
export const BENCH_NAMES = Object.fromEntries(Object.entries(BENCH_OPTIONS).map(([name, code]) => [code, name]));
export const CASE_TYPE_LABELS = new Map(CASE_TYPES.map(({ value, label }) => [String(value), label]));
export const CASE_YEAR_SET = new Set(CASE_YEARS.filter(Boolean).map(String));
export const CORAM_CODES = new Set(Object.values(CORAM_OPTIONS).map(String));
export const CORAM_NAMES = Object.fromEntries(Object.entries(CORAM_OPTIONS).map(([name, code]) => [String(code), name]));
export const REPORT_CODES = new Set(Object.values(REPORT_TYPE_OPTIONS).map(String));
export const REPORT_NAMES = Object.fromEntries(
  Object.entries(REPORT_TYPE_OPTIONS).map(([name, code]) => [String(code), name]),
);

const DATE_RE = /^\d{2}-\d{2}-\d{4}$/;

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (y, m) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

/** True for a real calendar date written DD-MM-YYYY. */
export function validDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [d, m, y] = s.split('-').map(Number);
  return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/** Sortable number for a DD-MM-YYYY date. */
export function dateKey(s) {
  const [d, m, y] = s.split('-').map(Number);
  return y * 10_000 + m * 100 + d;
}
