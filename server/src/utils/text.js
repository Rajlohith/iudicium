/**
 * Plain string helpers (ports of scraper/text_utils.py). No I/O in here.
 */

import { NO_DATA_MARKERS } from '../config.js';

// ASCII control characters that are illegal in Excel/XML cell values.
// Tab (\x09), newline (\x0a) and carriage return (\x0d) are kept.
// eslint-disable-next-line no-control-regex
const ILLEGAL_XLSX_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;

// Excel's hard limit for the text in a single cell.
const MAX_CELL_CHARS = 32_767;

/** Strip characters Excel cannot store; cap the length; leave non-strings alone. */
export function excelSafe(value) {
  if (typeof value !== 'string') return value;
  const cleaned = value.replace(ILLEGAL_XLSX_CHARS, '');
  return cleaned.length > MAX_CELL_CHARS ? cleaned.slice(0, MAX_CELL_CHARS) : cleaned;
}

/** Collapse whitespace and turn the site's "no data" placeholders into "". */
export function cleanText(text) {
  if (text === null || text === undefined) return '';
  const collapsed = String(text).replace(ILLEGAL_XLSX_CHARS, '').split(/\s+/).filter(Boolean).join(' ');
  return NO_DATA_MARKERS.has(collapsed.trim().toLowerCase()) ? '' : collapsed;
}

/** Keep user-provided names safe for use in output filenames. */
export function sanitizeFilenamePart(name) {
  const cleaned = String(name ?? '')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/^[ .]+|[ .]+$/g, '');
  return cleaned || 'Search';
}

/** "Petitioner V/S Respondent" -> [petitioner, respondent]. */
export function splitPartyNames(value) {
  const cleaned = cleanText(value);
  const match = cleaned.match(/^(.*?)\s+V\/S\s+(.*)$/is);
  return match ? [match[1], match[2]] : [cleaned, ''];
}

/** Whitespace-collapsed string, '' for null/undefined. */
export function clean(value) {
  if (value === null || value === undefined) return '';
  return String(value).split(/\s+/).filter(Boolean).join(' ').trim();
}
