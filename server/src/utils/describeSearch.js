/**
 * A one-line, human-readable description of a saved search, e.g.
 *   "Principal Bench · 01-01-2024 → 31-03-2024 · Respondent: Infosys"
 *   "WP 48907/2023 · Dharwad Bench"
 * Shown in the search history.
 */

import { BENCH_NAMES, CASE_TYPE_LABELS } from '../services/reference.js';

const has = (v) => v !== null && v !== undefined && String(v).trim() !== '';

/** "WP - Writ Petition" -> "WP" */
const caseTypeAbbreviation = (code) => (CASE_TYPE_LABELS.get(String(code)) ?? String(code)).split(' - ')[0];

export function describeSearch(kind, p) {
  const parts = [];

  if (has(p.case_type) && has(p.case_no) && has(p.case_year)) {
    parts.push(`${caseTypeAbbreviation(p.case_type)} ${p.case_no}/${p.case_year}`);
  }
  parts.push(BENCH_NAMES[p.db_bench] ?? p.db_bench);

  if (kind === 'detailed') {
    if (has(p.from_date) && has(p.to_date)) parts.push(`${p.from_date} → ${p.to_date}`);
    if (has(p.petitioner_name)) parts.push(`Petitioner: ${p.petitioner_name}`);
    if (has(p.respondent_name)) parts.push(`Respondent: ${p.respondent_name}`);
    if (has(p.petitioner_adv)) parts.push(`Petitioner's advocate: ${p.petitioner_adv}`);
    if (has(p.respondent_adv)) parts.push(`Respondent's advocate: ${p.respondent_adv}`);
    if (Array.isArray(p.aliases) && p.aliases.length) {
      const side = p.alias_field === 'petname' ? 'Petitioner' : 'Respondent';
      const shown = p.aliases.slice(0, 3).join(', ');
      parts.push(`${side}s: ${shown}${p.aliases.length > 3 ? ` +${p.aliases.length - 3} more` : ''}`);
    }
  }
  return parts.join(' · ').slice(0, 300);
}
