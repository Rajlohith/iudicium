/**
 * Conversational assistant that turns a chat into search parameters.
 *
 * Each turn sends the whole conversation to the LLM and asks for JSON
 * back: a short natural-language reply plus the *complete* set of search
 * fields understood so far. The LLM only interprets language. Everything
 * that matters is checked here, in code:
 *
 *   - every value is validated against shared/config.json (bench, case
 *     type code, case year, coram, report type, date format)
 *   - the "enough to search" rule is enforced here, not by the model:
 *       - bench is always required
 *       - AND EITHER a Date of Order range (from_date + to_date)
 *         OR a full case identity (case_type + case_no + case_year)
 *   - which scraper to run is decided here:
 *       - "quick"    -> the site's Quick Search by Case No. page, when the
 *                       request is exactly bench + type + number + year
 *       - "detailed" -> the full Detailed Search page for everything else
 *
 * If the model claims it's ready but the rules say otherwise, the rules
 * win and the missing pieces are appended to the reply as a question.
 */

import { CASE_TYPES, SECTION_NAMES } from '../config.js';
import { clean } from '../utils/text.js';
import { generate, LlmError } from './llm.js';
import {
  BENCH_CODES,
  BENCH_NAMES,
  CASE_TYPE_LABELS,
  CASE_YEAR_SET,
  CORAM_CODES,
  CORAM_NAMES,
  REPORT_CODES,
  REPORT_NAMES,
  dateKey,
  validDate,
} from './reference.js';

export { LlmError };

/**
 * The model's reply, tidied but with its line breaks kept: headings and
 * bullet lists only render if each one stays on its own line.
 */
export function cleanReply(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ----------------------------------------------------------------------
// Reference data
// ----------------------------------------------------------------------

const TEXT_FIELDS = ['petitioner_name', 'respondent_name', 'petitioner_adv', 'respondent_adv', 'judge', 'author_judge'];
const SECTION_NAMES_LOWER = new Map(SECTION_NAMES.map((n) => [n.toLowerCase(), n]));

export const ALL_FIELDS = [
  'db_bench',
  'case_type',
  'case_no',
  'case_year',
  'from_date',
  'to_date',
  'coram',
  'report_type',
  'aliases',
  'alias_field',
  'included_sections',
  ...TEXT_FIELDS,
];


// ----------------------------------------------------------------------
// Fetched-case context (for Q&A / summaries about a completed search)
// ----------------------------------------------------------------------

const MAX_CASES_IN_CONTEXT = 40; // how many fetched cases get full detail in the prompt
const MAX_CONTEXT_CHARS = 45_000; // overall budget for the case-context block
const MAX_INFO_CHARS = 700; // per-case "case information" text
const MAX_SECTION_CHARS = 500; // per-section text
// When the person is focused on ONE case (the "Summarise" button), spend the whole
// budget on it instead of squeezing it like one of forty.
const SINGLE_INFO_CHARS = 3_000;
const SINGLE_SECTION_CHARS = 4_000;

function truncate(text, limit) {
  const t = clean(text);
  return t.length <= limit ? t : `${t.slice(0, limit).trimEnd()}…`;
}

/** One case (shaped like the serialized scraper results) as plain text for the prompt. */
function oneCaseBlock(c, idx, infoChars = MAX_INFO_CHARS, sectionChars = MAX_SECTION_CHARS) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return '';

  const caseType = clean(c.case_type);
  const caseNo = clean(c.case_no);
  const caseYear = clean(c.case_year);
  let ident = [caseType, caseNo].filter(Boolean).join(' ');
  if (caseYear) ident = ident ? `${ident}/${caseYear}` : caseYear;

  const parties = [clean(c.petitioner), clean(c.respondent)].filter(Boolean).join(' vs ');

  let header = `[Case ${idx}] ${ident || 'Unknown case identity'}`;
  if (parties) header += ` — ${parties}`;

  const lines = [header];
  if (c.judgment_pdf) lines.push('Has a Judgment PDF on file.');

  const info = truncate(c.case_information ?? '', infoChars);
  if (info) lines.push(`Case information: ${info}`);

  if (c.sections && typeof c.sections === 'object' && !Array.isArray(c.sections)) {
    for (const [name, text] of Object.entries(c.sections)) {
      const t = truncate(text, sectionChars);
      if (t) lines.push(`${clean(name)}: ${t}`);
    }
  }
  return lines.join('\n');
}

/** The person's already-fetched cases as a bounded block of text, or "" when there's nothing to show. */
function caseContextBlock(cases) {
  if (!Array.isArray(cases) || !cases.length) return '';

  const single = cases.length === 1;
  const blocks = [];
  let totalChars = 0;
  let shown = 0;
  for (let i = 0; i < cases.length; i += 1) {
    if (shown >= MAX_CASES_IN_CONTEXT) break;
    let block = single
      ? oneCaseBlock(cases[i], i + 1, SINGLE_INFO_CHARS, SINGLE_SECTION_CHARS)
      : oneCaseBlock(cases[i], i + 1);
    // A lone case must never be dropped for being long: cut it to the budget instead.
    if (single && block.length > MAX_CONTEXT_CHARS) block = `${block.slice(0, MAX_CONTEXT_CHARS).trimEnd()}…`;
    if (!block) continue;
    if (totalChars + block.length > MAX_CONTEXT_CHARS) break;
    blocks.push(block);
    totalChars += block.length;
    shown += 1;
  }
  if (!blocks.length) return '';

  const remaining = cases.length - shown;
  let header =
    `The person has already run a search and fetched ${cases.length} case(s). ` +
    'Use ONLY the data below to answer questions about them or to produce ' +
    "summaries/overviews -- never invent facts, dates, or outcomes that " +
    "aren't shown here. Refer to cases by their case type/number/year so " +
    "it's clear which one you mean.";
  if (remaining > 0) {
    header +=
      ` (Full detail is shown for the first ${shown} of ${cases.length} cases; ` +
      `the remaining ${remaining} were fetched too but aren't detailed here -- ` +
      'say so if asked about one of those.)';
  }
  return `${header}\n\n${blocks.join('\n\n')}`;
}

// ----------------------------------------------------------------------
// Prompt
// ----------------------------------------------------------------------

const caseTypeReference = () => CASE_TYPES.map(({ value, label }) => `  ${value} = ${label}`).join('\n');

const pad2 = (n) => String(n).padStart(2, '0');
const todayDdMmYyyy = (now = new Date()) => `${pad2(now.getDate())}-${pad2(now.getMonth() + 1)}-${now.getFullYear()}`;

export function systemPrompt(caseContext = '', now = new Date()) {
  const today = todayDdMmYyyy(now);
  const years = [...CASE_YEAR_SET].sort().reverse().join(', ');

  let prompt = `You are the search assistant inside a Karnataka High Court case-search tool.
Your job is to understand what the person wants to search for and turn it
into values for the court website's search form, AND -- once a search has
been run -- to answer questions about the fetched cases and produce
summaries/overviews of them. You never run the search yourself and you
never invent case data -- a separate scraper does the searching, and any
facts you state about a case must come from the data given to you.

Today's date is ${today} (DD-MM-YYYY). Use it to resolve relative dates like
"last 6 months", "this year", "since January".

RULES FOR A SEARCH TO BE POSSIBLE (the tool enforces these; you must too):
  1. Bench is ALWAYS required: "B" Principal Bench (Bengaluru), "D" Dharwad, "K" Kalaburagi.
  2. AND at least ONE of:
       a) a Date of Order range: from_date AND to_date, DD-MM-YYYY
       b) a full case identity: case_type AND case_no AND case_year
If any of these is missing, ask for it -- one clear question at a time,
plain language, no jargon. If the person gives a single date, ask what
range they want. If they name a case type in words (e.g. "writ petition"),
map it to the code from the list below. If they say "Bangalore" or
"Bengaluru" that is the Principal Bench "B".

Keep replies short (1-3 sentences). Do not list the fields back to them --
the interface shows a parameter card automatically. When everything needed
is present, say so briefly and tell them to press Run search.

Also answer general questions about how to use the tool (Detailed Search,
Quick Search, the Excel export) if asked, but steer back to the search.

ALWAYS respond with ONLY a JSON object of this exact shape (no markdown):
{
  "reply": "<your short message to the person>",
  "fields": { ...every field you are confident about, accumulated across the WHOLE conversation... }
}

"fields" must contain the full current state, not just what changed this
turn. Only include a key if you are confident of its value; never guess.
Allowed keys:
  "db_bench": "B" | "D" | "K"
  "case_type": case-type CODE as a string from the list below
  "case_no": digits only, max 6
  "case_year": 4-digit year as a string
  "from_date": "DD-MM-YYYY"
  "to_date": "DD-MM-YYYY"
  "petitioner_name": free text
  "respondent_name": free text
  "petitioner_adv": advocate name, free text
  "respondent_adv": advocate name, free text
  "judge": judge name, free text (only if explicitly given)
  "author_judge": judge name, free text (only if explicitly given)
  "coram": "1" Single Bench | "2" Division Bench | "3" Full Bench | "99" Subject Roaster
  "report_type": "Y" Reported | "N" Non-Reported | "none"
  "aliases": array of strings -- ONLY when the person wants several different
             parties/entities searched one after another in one run
  "alias_field": "respondname" | "petname" -- which side the aliases are on
  "included_sections": array of section names -- ONLY when the person
             explicitly limits what data they want (e.g. "just the daily
             orders and the judgment PDFs"). Valid names:
             ${SECTION_NAMES.join(', ')}.
             Map loose phrasings to these exact names
             ("orders" -> "Daily Orders Information", "the pdf" ->
             "Judgment PDF", "parties" -> "Party Information"). If they
             never limit it, OMIT this key -- everything is included by
             default.

When a person mentions ONE party ("cases against X", "X vs State") put it in
petitioner_name / respondent_name, not aliases. "against X" / "vs X" usually
means X is the respondent. Use aliases only for lists like "search for
Infosys, Wipro and TCS".

Case Type codes:
${caseTypeReference()}

Valid case years: ${years}
`;

  if (caseContext) {
    prompt += `

ANSWERING QUESTIONS ABOUT FETCHED CASES:
The person may ask about cases they already fetched, e.g. "what's the
status of the second case", "who is the judge on WP 12345/2023", "any
pending IAs", or ask for a summary/overview ("summarize these",
"give me an overview of the results"). When that's clearly what they
want, answer directly and conversationally using the case data below --
do NOT treat it as a new search request and do NOT ask for bench/date/
case-identity fields just to answer a question about data you already
have. Use markdown (short paragraphs, bold, bullet lists) where it helps
readability, and mention which case (by type/number/year) each fact comes
from when more than one case is discussed. If something isn't present in
the data, say you don't have that detail rather than guessing. Only fall
back to the normal search-parameter flow when the person is clearly
describing a new/different search.

FETCHED CASES:
${caseContext}
`;
  }

  return prompt;
}

// ----------------------------------------------------------------------
// Validation / normalisation
// ----------------------------------------------------------------------

function matchCaseType(text) {
  const t = text.trim().toLowerCase();
  for (const { value, label } of CASE_TYPES) {
    const l = label.toLowerCase();
    if (t === l) return String(value);
    const sep = l.indexOf(' - ');
    if (sep !== -1) {
      const abbr = l.slice(0, sep).trim();
      const desc = l.slice(sep + 3).trim();
      if (t === abbr || t === desc) return String(value);
    }
  }
  return null;
}

/** Keep only known fields with valid values. Returns { fields, warnings }. */
export function normaliseFields(raw) {
  const fields = {};
  const warnings = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { fields, warnings };

  const bench = clean(raw.db_bench).toUpperCase();
  if (BENCH_CODES.has(bench)) fields.db_bench = bench;
  else if (bench) warnings.push(`Ignored unknown bench '${bench}'.`);

  const ct = clean(raw.case_type);
  if (ct) {
    if (CASE_TYPE_LABELS.has(ct)) {
      fields.case_type = ct;
    } else {
      // The model may have returned the label ("WP - Writ Petition"),
      // the abbreviation ("WP") or the description ("Writ Petition").
      const match = matchCaseType(ct);
      if (match) fields.case_type = match;
      else warnings.push(`Ignored unknown case type '${ct}'.`);
    }
  }

  const cn = clean(raw.case_no).replace(/\D/g, '');
  if (cn) {
    if (cn.length <= 6) fields.case_no = cn;
    else warnings.push('Case number must be at most 6 digits.');
  }

  const cy = clean(raw.case_year);
  if (cy) {
    if (CASE_YEAR_SET.has(cy)) fields.case_year = cy;
    else warnings.push(`Ignored case year '${cy}' (not in the site's list).`);
  }

  for (const key of ['from_date', 'to_date']) {
    const v = clean(raw[key]).replaceAll('/', '-');
    if (v) {
      if (validDate(v)) fields[key] = v;
      else warnings.push(`Ignored ${key.replace('_', ' ')} '${v}' -- needs DD-MM-YYYY.`);
    }
  }

  if (fields.from_date && fields.to_date && dateKey(fields.from_date) > dateKey(fields.to_date)) {
    [fields.from_date, fields.to_date] = [fields.to_date, fields.from_date];
    warnings.push('Swapped the dates so the range runs forwards.');
  }

  const coram = clean(raw.coram);
  if (coram) {
    if (CORAM_CODES.has(coram)) fields.coram = coram;
    else warnings.push(`Ignored unknown coram '${coram}'.`);
  }

  const rt = clean(raw.report_type);
  if (rt) {
    if (REPORT_CODES.has(rt)) fields.report_type = rt;
    else warnings.push(`Ignored unknown report type '${rt}'.`);
  }

  for (const key of TEXT_FIELDS) {
    const v = clean(raw[key]);
    if (v) fields[key] = v.slice(0, 200);
  }

  if (Array.isArray(raw.aliases)) {
    const cleaned = raw.aliases.map((a) => clean(a).slice(0, 200)).filter(Boolean);
    if (cleaned.length) {
      fields.aliases = cleaned;
      const af = clean(raw.alias_field);
      fields.alias_field = af === 'respondname' || af === 'petname' ? af : 'respondname';
    }
  }

  if (Array.isArray(raw.included_sections)) {
    const valid = [];
    for (const s of raw.included_sections) {
      const name = SECTION_NAMES_LOWER.get(clean(s).toLowerCase());
      if (name) {
        if (!valid.includes(name)) valid.push(name);
      } else if (clean(s)) {
        warnings.push(`Ignored unknown section '${clean(s)}'.`);
      }
    }
    if (valid.length) fields.included_sections = valid;
  }

  return { fields, warnings };
}

const hasAll = (fields, keys) => keys.every((k) => k in fields);

/** Human-readable list of what still has to be provided. */
export function missingRequirements(fields) {
  const missing = [];
  if (!('db_bench' in fields)) missing.push('bench (Principal/Bengaluru, Dharwad or Kalaburagi)');

  const hasDates = hasAll(fields, ['from_date', 'to_date']);
  const hasIdentity = hasAll(fields, ['case_type', 'case_no', 'case_year']);

  if (!hasDates && !hasIdentity) {
    // Tell them the nearest path to completeness.
    const partialIdentity = ['case_type', 'case_no', 'case_year'].filter((k) => k in fields);
    const partialDates = ['from_date', 'to_date'].filter((k) => k in fields);
    if (partialIdentity.length && !partialDates.length) {
      const need = ['case_type', 'case_no', 'case_year'].filter((k) => !(k in fields)).map((k) => k.replaceAll('_', ' '));
      missing.push(`the rest of the case identity: ${need.join(', ')} (or a date range instead)`);
    } else if (partialDates.length) {
      const need = 'from_date' in fields ? 'end date' : 'start date';
      missing.push(`the ${need} of the Date of Order range`);
    } else {
      missing.push('a Date of Order range (from and to), or the full Case Type + Number + Year');
    }
  }
  return missing;
}

/**
 * 'quick' when the request is exactly bench + case identity and nothing
 * else; 'detailed' for everything that needs the full form. A section
 * filter doesn't change which form is needed, so it's not an 'extra'.
 */
export function chooseMode(fields) {
  const hasIdentity = hasAll(fields, ['case_type', 'case_no', 'case_year']);
  const quickKeys = new Set(['db_bench', 'case_type', 'case_no', 'case_year', 'included_sections']);
  const extras = Object.keys(fields).filter((k) => !quickKeys.has(k));
  return hasIdentity && !extras.length ? 'quick' : 'detailed';
}

/** Labelled view for the UI's parameter card. */
export function describeFields(fields) {
  const out = [];
  const add = (key, value) => out.push({ key, value });

  if ('db_bench' in fields) add('Bench', BENCH_NAMES[fields.db_bench] ?? fields.db_bench);
  if ('case_type' in fields) add('Case type', `${CASE_TYPE_LABELS.get(fields.case_type) ?? '?'} (${fields.case_type})`);
  if ('case_no' in fields) add('Case number', fields.case_no);
  if ('case_year' in fields) add('Case year', fields.case_year);
  if ('from_date' in fields || 'to_date' in fields) {
    add('Date of order', `${fields.from_date ?? '…'} → ${fields.to_date ?? '…'}`);
  }
  if ('petitioner_name' in fields) add('Petitioner', fields.petitioner_name);
  if ('respondent_name' in fields) add('Respondent', fields.respondent_name);
  if ('petitioner_adv' in fields) add("Petitioner's advocate", fields.petitioner_adv);
  if ('respondent_adv' in fields) add("Respondent's advocate", fields.respondent_adv);
  if ('judge' in fields) add('Judge', fields.judge);
  if ('author_judge' in fields) add('Author judge', fields.author_judge);
  if ('coram' in fields) add('Coram', CORAM_NAMES[fields.coram] ?? fields.coram);
  if ('report_type' in fields) add('Report type', REPORT_NAMES[fields.report_type] ?? fields.report_type);
  if ('aliases' in fields) {
    const side = (fields.alias_field ?? 'respondname') === 'respondname' ? 'respondent' : 'petitioner';
    add(`Aliases (${side})`, fields.aliases.join(', '));
  }
  if ('included_sections' in fields) add('Sections', fields.included_sections.join(', '));
  return out;
}

// ----------------------------------------------------------------------
// Turn handling
// ----------------------------------------------------------------------

function stripCodeFences(raw) {
  return raw
    .trim()
    .replace(/^```[a-zA-Z]*\n?/, '')
    .replace(/\n?```$/, '')
    .trim();
}

export function parseModelJson(raw) {
  const cleaned = stripCodeFences(raw);
  const fallback = { reply: cleaned, fields: {} };
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Salvage: find the outermost {...}
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return fallback;
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return fallback;
    }
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
}

/** Reminds the model of the validated state so it accumulates correctly. */
function fieldsStateNote(fields) {
  if (!Object.keys(fields).length) return '';
  return `\n\n[Current validated search fields, keep these unless the person changes them: ${JSON.stringify(fields)}]`;
}

/**
 * messages:    [{ role: 'user' | 'assistant', content }], oldest first.
 * knownFields: the fields the UI already holds (validated on a previous
 *              turn), so the model doesn't drop them.
 * cases:       the case list from the most recently completed search in
 *              this session, if any -- lets the model answer questions
 *              and summaries about real results.
 *
 * Returns { reply, fields, display, missing, ready, mode, warnings }.
 * Throws LlmError if the model is unreachable / misconfigured.
 */
export async function assistantTurn(messages, knownFields = {}, cases = []) {
  const { fields: known } = normaliseFields(knownFields);

  // Only the last user message gets the state note appended; earlier
  // turns are passed verbatim.
  const convo = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .map((m) => ({ role: m.role, content: m.content }));
  if (convo.length && convo[convo.length - 1].role === 'user') {
    convo[convo.length - 1].content += fieldsStateNote(known);
  }

  const caseContext = caseContextBlock(cases);
  const raw = await generate(convo, { system: systemPrompt(caseContext), jsonMode: true, temperature: 0.2 });
  const parsed = parseModelJson(raw);

  let reply = cleanReply(parsed.reply) || 'Okay.';
  const modelFields = parsed.fields && typeof parsed.fields === 'object' && !Array.isArray(parsed.fields) ? parsed.fields : {};

  // The model returns the full state; merge on top of what we knew so a
  // forgetful reply can't silently erase a confirmed value.
  const { fields, warnings } = normaliseFields({ ...known, ...modelFields });

  const missing = missingRequirements(fields);
  const ready = missing.length === 0;
  const mode = ready ? chooseMode(fields) : null;

  // Guardrail: the tool decides readiness, not the model. But once cases
  // have already been fetched, don't nag about missing search fields --
  // the person is most likely asking about those results, not building
  // a new search.
  if (missing.length && !caseContext && !reply.includes('?')) {
    reply = `${reply.replace(/\.+$/, '')}. I still need ${missing[0]} — could you give me that?`;
  }

  return { reply, fields, display: describeFields(fields), missing, ready, mode, warnings };
}

/** Translate validated assistant fields into the exact body for /api/search or /api/case-number-search. */
export function buildSearchPayload(fields) {
  const mode = chooseMode(fields);
  if (mode === 'quick') {
    const body = {
      db_bench: fields.db_bench,
      case_type: fields.case_type,
      case_no: fields.case_no,
      case_year: fields.case_year,
    };
    if (fields.included_sections) body.included_sections = fields.included_sections;
    return { mode, body };
  }

  const body = { db_bench: fields.db_bench };
  for (const k of ALL_FIELDS) {
    if (k in fields && k !== 'db_bench') body[k] = fields[k];
  }
  body.aliases ??= [];
  body.alias_field ??= 'respondname';
  return { mode, body };
}

/**
 * One-shot natural language -> structured search-form values (the
 * /api/ai-fill route). Returns { fields, notes }.
 */
export async function aiFillForm(text) {
  const result = await assistantTurn([{ role: 'user', content: text }]);
  const notes = [];
  const missing = missingRequirements(result.fields);
  if (missing.length) notes.push(`Still needed: ${missing.join('; ')}.`);
  notes.push(...(result.warnings ?? []));
  return { fields: result.fields, notes: notes.length ? notes.join(' ') : null };
}
