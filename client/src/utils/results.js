import { KEYS, readJson, remove, writeJson } from './storage.js';

export const resultsKey = (kind) => (kind === 'quick' ? KEYS.quickResults : KEYS.detailedResults);

/** One-line summary shown above the results. */
export function summarize(kind, payload) {
  if (kind === 'quick') {
    return payload.case_count ? `${payload.case_count} case(s) found.` : 'No case matched that Case Type / Number / Year.';
  }
  return `${payload.case_count} unique case(s) found, ${payload.duplicates_skipped} duplicate(s) skipped.`;
}

/** Text for the progress bar once a job has finished. */
export function doneLabel(kind, payload) {
  if (kind === 'quick') {
    if (payload.cancelled) return 'Stopped.';
    return payload.case_count ? 'Done — case found.' : 'Done — no matching case found.';
  }
  const counts = `${payload.case_count} case(s) saved, ${payload.duplicates_skipped} duplicate(s) skipped.`;
  return `${payload.cancelled ? 'Stopped' : 'Done'} — ${counts}`;
}

/** What a results panel needs, built from a server `done` payload. */
export function buildResults(kind, payload) {
  return {
    cases: payload.cases ?? [],
    summary: summarize(kind, payload),
    downloadHref: `/outputs/${encodeURIComponent(payload.output_filename)}`,
    filename: payload.output_filename,
  };
}

export const saveResults = (kind, results) => writeJson(resultsKey(kind), results);
export const clearResults = (kind) => remove(resultsKey(kind));

export function loadResults(kind) {
  const stored = readJson(resultsKey(kind));
  return stored?.cases?.length || stored?.filename ? stored : null;
}
