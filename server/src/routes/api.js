/**
 * REST API.
 *
 *   (everything below requires a signed-in, allow-listed user; see services/auth.js)
 *   GET  /api/form-options        static dropdown data
 *   POST /api/judges              live Judge/Author Judge options for a bench
 *   POST /api/ai-fill             one-shot natural language -> field values
 *   POST /api/assistant           conversational turn
 *   POST /api/assistant/run       start the right scraper from validated fields
 *   POST /api/search              start a Detailed Search
 *   POST /api/search/stop         ask the running search to stop
 *   POST /api/case-number-search  start a Quick Search by Case No.
 *   GET  /api/search/status       is a search running? + how the last one ended
 *   GET  /api/search/result       the last finished search (fallback for a missed WebSocket message)
 *   GET  /api/diagnostics         can the scraper run on this machine?
 *   GET|DELETE /api/logs/:page    buffered activity log ("search" | "case_number")
 *   GET    /api/history           the person's saved searches (newest first)
 *   DELETE /api/history/:id       forget one saved search
 *   DELETE /api/history           forget them all (except one still running)
 */

import { Router } from 'express';

import {
  BENCH_OPTIONS,
  CASE_TYPES,
  CASE_YEARS,
  CORAM_OPTIONS,
  REPORT_TYPE_OPTIONS,
  SECTION_NAMES,
} from '../config.js';
import {
  LlmError,
  aiFillForm,
  assistantTurn,
  buildSearchPayload,
  missingRequirements,
  normaliseFields,
} from '../services/assistant.js';
import {
  aiFillSchema,
  assistantRequestSchema,
  assistantRunSchema,
  caseNumberCriteriaSchema,
  checkCaseNumberCriteria,
  checkSearchCriteria,
  judgeLookupSchema,
  searchCriteriaSchema,
} from '../services/validation.js';
import { checkScraperEnvironment, preflightProblem } from '../services/diagnostics.js';
import { BENCH_CODES } from '../services/reference.js';
import { describeSearch } from '../utils/describeSearch.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Parse req.body with a zod schema or answer 422 and return null. */
function parse(schema, req, res) {
  const result = schema.safeParse(req.body ?? {});
  if (result.success) return result.data;
  res.status(422).json({
    error: 'Invalid request.',
    details: result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
  });
  return null;
}

const LOG_PAGES = new Set(['search', 'case_number']);

/**
 * Save the search to the person's history, then start it. If the scraper turns
 * out to be busy the record is withdrawn again, so history only holds real runs.
 */
function startRecorded({ jobManager, store, user, kind, source, params }) {
  const historyId = store.addSearch({ userId: user.id, kind, source, title: describeSearch(kind, params), params });
  const who = { userId: user.id, historyId };
  const started = kind === 'quick' ? jobManager.startQuick(params, who) : jobManager.startDetailed(params, who);
  if (!started.started) store.deleteSearch(user.id, historyId);
  return started;
}

export function createApiRouter(jobManager, store) {
  const router = Router();

  router.get('/form-options', (_req, res) => {
    res.json({
      db_bench: Object.entries(BENCH_OPTIONS).map(([label, value]) => ({ value, label })),
      case_types: CASE_TYPES,
      case_years: CASE_YEARS,
      coram: Object.entries(CORAM_OPTIONS).map(([label, value]) => ({ value, label })),
      report_type: Object.entries(REPORT_TYPE_OPTIONS).map(([label, value]) => ({ value, label })),
      sections: SECTION_NAMES,
    });
  });

  router.post(
    '/judges',
    wrap(async (req, res) => {
      const body = parse(judgeLookupSchema, req, res);
      if (!body) return;
      if (!BENCH_CODES.has(body.db_bench)) return res.json({ judges: [], error: 'db_bench must be B, D or K.' });
      try {
        res.json({ judges: await jobManager.fetchJudges(body.db_bench) });
      } catch (err) {
        res.json({ judges: [], error: err.message }); // surfaced to the UI
      }
    }),
  );

  // -- AI ----------------------------------------------------------------

  router.post(
    '/ai-fill',
    wrap(async (req, res) => {
      const body = parse(aiFillSchema, req, res);
      if (!body) return;
      try {
        res.json(await aiFillForm(body.text));
      } catch (err) {
        if (!(err instanceof LlmError)) throw err;
        res.json({ fields: {}, notes: err.message });
      }
    }),
  );

  router.post(
    '/assistant',
    wrap(async (req, res) => {
      const body = parse(assistantRequestSchema, req, res);
      if (!body) return;
      try {
        res.json(await assistantTurn(body.messages, body.fields, body.cases));
      } catch (err) {
        if (!(err instanceof LlmError)) throw err;
        const { fields } = normaliseFields(body.fields);
        res.json({
          reply: `Sorry, I couldn't reach the AI model: ${err.message}`,
          fields,
          display: [],
          missing: missingRequirements(fields),
          ready: false,
          mode: null,
          warnings: [],
          error: err.message,
        });
      }
    }),
  );

  router.post('/assistant/run', wrap(async (req, res) => {
    const body = parse(assistantRunSchema, req, res);
    if (!body) return;

    const { fields } = normaliseFields(body.fields);
    const missing = missingRequirements(fields);
    if (missing.length) {
      return res.json({ started: false, message: `Can't run yet — still need ${missing.join('; ')}.` });
    }

    const problem = await preflightProblem();
    if (problem) return res.json({ started: false, message: problem });

    const { mode, body: payload } = buildSearchPayload(fields);
    if (body.output_filename) payload.output_filename = body.output_filename;
    const started = startRecorded({ jobManager, store, user: req.user, kind: mode, source: 'assistant', params: payload });
    res.json({ ...started, mode });
  }));

  // -- searches ----------------------------------------------------------

  router.post('/search', wrap(async (req, res) => {
    const body = parse(searchCriteriaSchema, req, res);
    if (!body) return;
    const problem = checkSearchCriteria(body);
    if (problem) return res.status(422).json({ error: problem });
    const broken = await preflightProblem();
    if (broken) return res.status(503).json({ error: broken });
    res.json(startRecorded({ jobManager, store, user: req.user, kind: 'detailed', source: 'form', params: body }));
  }));

  router.post('/case-number-search', wrap(async (req, res) => {
    const body = parse(caseNumberCriteriaSchema, req, res);
    if (!body) return;
    const problem = checkCaseNumberCriteria(body);
    if (problem) return res.status(422).json({ error: problem });
    const broken = await preflightProblem();
    if (broken) return res.status(503).json({ error: broken });
    res.json(startRecorded({ jobManager, store, user: req.user, kind: 'quick', source: 'form', params: body }));
  }));

  router.post('/search/stop', (req, res) => res.json({ stopped: jobManager.requestStop(req.user.id) }));

  router.get('/search/status', (req, res) => res.json(jobManager.statusFor(req.user.id)));

  router.get('/search/result', (req, res) => {
    const result = jobManager.lastResultFor(req.user.id);
    if (!result) return res.status(404).json({ error: 'No finished search yet.' });
    res.json(result);
  });

  router.get('/diagnostics', wrap(async (_req, res) => res.json(await checkScraperEnvironment({ force: true }))));

  // -- activity-log buffer -------------------------------------------------

  router.get('/logs/:page', (req, res) => {
    if (!LOG_PAGES.has(req.params.page)) return res.status(404).json({ error: `Unknown page '${req.params.page}'.` });
    res.json({ entries: jobManager.getLog(req.user.id, req.params.page) });
  });

  router.delete('/logs/:page', (req, res) => {
    if (!LOG_PAGES.has(req.params.page)) return res.status(404).json({ error: `Unknown page '${req.params.page}'.` });
    jobManager.clearLog(req.user.id, req.params.page);
    res.json({ cleared: true });
  });

  // -- search history -------------------------------------------------------

  router.get('/history', (req, res) => {
    res.json({ searches: store.listSearches(req.user.id) });
  });

  router.delete('/history/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'No such saved search.' });
    if (!store.deleteSearch(req.user.id, id)) return res.status(404).json({ error: 'No such saved search.' });
    res.json({ deleted: true });
  });

  router.delete('/history', (req, res) => {
    res.json({ deleted: store.clearSearches(req.user.id) });
  });

  return router;
}
