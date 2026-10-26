/**
 * Request schemas (zod) and the semantic rules the site itself enforces.
 *
 * The browser form already checks most of this, but the API must not rely
 * on that: a bad request should be rejected here, with a clear message,
 * rather than launching a browser session that is bound to fail.
 */

import { z } from 'zod';

import {
  BENCH_CODES,
  CASE_TYPE_LABELS,
  CASE_YEAR_SET,
  CORAM_CODES,
  REPORT_CODES,
  dateKey,
  validDate,
} from './reference.js';

const optionalString = z.string().nullish();

export const searchCriteriaSchema = z.object({
  db_bench: z.string(),
  aliases: z.array(z.string()).nullish(),
  alias_field: z.enum(['respondname', 'petname']).nullish(),
  from_date: optionalString,
  to_date: optionalString,
  judge: optionalString,
  author_judge: optionalString,
  coram: optionalString,
  case_type: optionalString,
  case_no: optionalString,
  case_year: optionalString,
  petitioner_name: optionalString,
  respondent_name: optionalString,
  petitioner_adv: optionalString,
  respondent_adv: optionalString,
  report_type: optionalString,
  included_sections: z.array(z.string()).nullish(),
  output_filename: optionalString,
});

export const caseNumberCriteriaSchema = z.object({
  db_bench: z.string(),
  case_type: z.string(),
  case_no: z.string(),
  case_year: z.string(),
  included_sections: z.array(z.string()).nullish(),
  output_filename: optionalString,
});

export const judgeLookupSchema = z.object({ db_bench: z.string() });

export const aiFillSchema = z.object({ text: z.string().min(1) });

export const assistantRequestSchema = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.string() })).max(200),
  fields: z.record(z.unknown()).default({}),
  cases: z.array(z.record(z.unknown())).default([]),
});

export const assistantRunSchema = z.object({
  fields: z.record(z.unknown()),
  output_filename: optionalString,
});

// ----------------------------------------------------------------------
// Semantic checks. Each returns an error message, or null when valid.
// ----------------------------------------------------------------------

const has = (v) => v !== null && v !== undefined && String(v).trim() !== '';

function checkCommon(c) {
  if (!BENCH_CODES.has(c.db_bench)) return 'Bench must be one of B (Principal), D (Dharwad) or K (Kalaburagi).';
  if (has(c.case_type) && !CASE_TYPE_LABELS.has(String(c.case_type))) return `Unknown case type '${c.case_type}'.`;
  if (has(c.case_no) && !/^\d{1,6}$/.test(String(c.case_no))) return 'Case number must be 1 to 6 digits.';
  if (has(c.case_year) && !CASE_YEAR_SET.has(String(c.case_year))) return `Unknown case year '${c.case_year}'.`;
  return null;
}

export function checkSearchCriteria(c) {
  const common = checkCommon(c);
  if (common) return common;

  if (has(c.coram) && !CORAM_CODES.has(String(c.coram))) return `Unknown coram '${c.coram}'.`;
  if (has(c.report_type) && !REPORT_CODES.has(String(c.report_type))) return `Unknown report type '${c.report_type}'.`;

  const hasFrom = has(c.from_date);
  const hasTo = has(c.to_date);
  if (hasFrom !== hasTo) return 'Give both a From and a To date, or neither.';
  if (hasFrom) {
    if (!validDate(c.from_date) || !validDate(c.to_date)) return 'Dates must be real dates written DD-MM-YYYY.';
    if (dateKey(c.from_date) > dateKey(c.to_date)) return 'The From date must not be after the To date.';
  }

  const hasIdentity = has(c.case_type) && has(c.case_no) && has(c.case_year);
  if (!hasFrom && !hasIdentity) {
    return 'Enter a Date of Order range, or fill in Case Type + Case Number + Case Year.';
  }
  return null;
}

export function checkCaseNumberCriteria(c) {
  const common = checkCommon(c);
  if (common) return common;
  if (!has(c.case_type) || !has(c.case_no) || !has(c.case_year)) {
    return 'Please fill in Bench, Case Type, Case Number, and Case Year.';
  }
  return null;
}
