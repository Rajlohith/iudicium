import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

process.env.LLM_PROVIDER = 'gemini';
process.env.GEMINI_API_KEY = 'test-key';

const {
  assistantTurn, buildSearchPayload, chooseMode, describeFields, missingRequirements, normaliseFields, parseModelJson, systemPrompt,
} = await import('../src/services/assistant.js');

describe('normaliseFields', () => {
  it('keeps valid values and drops invalid ones with warnings', () => {
    const { fields, warnings } = normaliseFields({
      db_bench: 'b', case_type: '144', case_no: 'No. 12345', case_year: '2023', from_date: '01/02/2024', to_date: '31-02-2024', coram: '7', report_type: 'Y',
    });
    assert.deepEqual(fields, { db_bench: 'B', case_type: '144', case_no: '12345', case_year: '2023', from_date: '01-02-2024', report_type: 'Y' });
    assert.equal(warnings.length, 2); // bad to_date, bad coram
  });

  it('maps case-type abbreviations and descriptions to the code', () => {
    assert.equal(normaliseFields({ case_type: 'WP' }).fields.case_type, '144');
    assert.equal(normaliseFields({ case_type: 'writ petition' }).fields.case_type, '144');
    assert.equal(normaliseFields({ case_type: 'WP - Writ Petition' }).fields.case_type, '144');
    assert.equal(normaliseFields({ case_type: 'nonsense' }).fields.case_type, undefined);
  });

  it('swaps a backwards date range', () => {
    const { fields, warnings } = normaliseFields({ from_date: '01-06-2024', to_date: '01-01-2024' });
    assert.equal(fields.from_date, '01-01-2024');
    assert.match(warnings[0], /Swapped/);
  });

  it('rejects impossible calendar dates and over-long case numbers', () => {
    assert.equal(normaliseFields({ from_date: '29-02-2023' }).fields.from_date, undefined);
    assert.equal(normaliseFields({ from_date: '29-02-2024' }).fields.from_date, '29-02-2024');
    assert.equal(normaliseFields({ case_no: '1234567' }).fields.case_no, undefined);
  });

  it('validates sections case-insensitively without duplicate warnings', () => {
    const { fields, warnings } = normaliseFields({ included_sections: ['daily orders information', 'Daily Orders Information', 'judgment pdf', 'bogus'] });
    assert.deepEqual(fields.included_sections, ['Daily Orders Information', 'Judgment PDF']);
    assert.deepEqual(warnings, ["Ignored unknown section 'bogus'."]);
  });

  it('defaults alias_field and ignores non-object input', () => {
    assert.deepEqual(normaliseFields({ aliases: [' A ', '', 'B'] }).fields, { aliases: ['A', 'B'], alias_field: 'respondname' });
    assert.deepEqual(normaliseFields(null).fields, {});
  });
});

describe('readiness and mode', () => {
  it('requires a bench plus dates or a full case identity', () => {
    assert.equal(missingRequirements({}).length, 2);
    assert.equal(missingRequirements({ db_bench: 'B', from_date: '01-01-2024', to_date: '02-01-2024' }).length, 0);
    assert.equal(missingRequirements({ db_bench: 'B', case_type: '144', case_no: '1', case_year: '2023' }).length, 0);
    assert.match(missingRequirements({ db_bench: 'B', case_type: '144' })[0], /case no, case year/);
    assert.match(missingRequirements({ db_bench: 'B', from_date: '01-01-2024' })[0], /end date/);
  });

  it('picks quick only for exactly bench + case identity', () => {
    const id = { db_bench: 'B', case_type: '144', case_no: '1', case_year: '2023' };
    assert.equal(chooseMode(id), 'quick');
    assert.equal(chooseMode({ ...id, included_sections: ['Judgment PDF'] }), 'quick');
    assert.equal(chooseMode({ ...id, petitioner_name: 'X' }), 'detailed');
    assert.equal(chooseMode({ db_bench: 'B', from_date: '01-01-2024', to_date: '02-01-2024' }), 'detailed');
  });

  it('builds the right request bodies', () => {
    const quick = buildSearchPayload({ db_bench: 'D', case_type: '144', case_no: '1', case_year: '2023' });
    assert.deepEqual(quick, { mode: 'quick', body: { db_bench: 'D', case_type: '144', case_no: '1', case_year: '2023' } });
    const detailed = buildSearchPayload({ db_bench: 'B', from_date: '01-01-2024', to_date: '02-01-2024', respondent_name: 'State' });
    assert.equal(detailed.mode, 'detailed');
    assert.deepEqual(detailed.body.aliases, []);
    assert.equal(detailed.body.alias_field, 'respondname');
  });

  it('describes fields for the parameter card', () => {
    const rows = describeFields({ db_bench: 'K', case_type: '144', from_date: '01-01-2024', to_date: '02-01-2024' });
    assert.deepEqual(rows.map((r) => r.key), ['Bench', 'Case type', 'Date of order']);
    assert.equal(rows[0].value, 'Kalaburagi Bench');
  });
});

describe('model output parsing', () => {
  it('handles fenced and noisy JSON, and plain text', () => {
    assert.deepEqual(parseModelJson('```json\n{"reply":"hi","fields":{}}\n```'), { reply: 'hi', fields: {} });
    assert.equal(parseModelJson('Sure! {"reply":"x","fields":{"db_bench":"B"}} done').fields.db_bench, 'B');
    assert.deepEqual(parseModelJson('just words'), { reply: 'just words', fields: {} });
    assert.deepEqual(parseModelJson('[1,2]'), { reply: '[1,2]', fields: {} });
  });
});

describe('systemPrompt', () => {
  it('lists every case type and only adds case data when there is some', () => {
    const base = systemPrompt('');
    assert.match(base, /144 = WP - Writ Petition/);
    assert.doesNotMatch(base, /FETCHED CASES/);
    assert.match(systemPrompt('[Case 1] WP 1/2023'), /FETCHED CASES:\n\[Case 1\]/);
    assert.match(systemPrompt('', new Date(2026, 0, 5)), /Today's date is 05-01-2026/);
  });
});

describe('assistantTurn (fake model)', () => {
  const realFetch = globalThis.fetch;
  let lastBody;
  const respondWith = (obj) => {
    globalThis.fetch = async (_url, init) => {
      lastBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }), { status: 200 });
    };
  };
  beforeEach(() => { lastBody = null; });
  afterEach(() => { globalThis.fetch = realFetch; });

  it('validates what the model claims and decides readiness itself', async () => {
    respondWith({ reply: 'Ready, press Run search.', fields: { db_bench: 'B', case_type: 'WP', case_no: '48907', case_year: '2023', bogus: 1 } });
    const out = await assistantTurn([{ role: 'user', content: 'WP 48907 of 2023, Bengaluru' }]);
    assert.equal(out.ready, true);
    assert.equal(out.mode, 'quick');
    assert.equal(out.fields.case_type, '144');
    assert.equal('bogus' in out.fields, false);
  });

  it('overrules a model that says it is ready when it is not, and asks for what is missing', async () => {
    respondWith({ reply: 'All set.', fields: { db_bench: 'B' } });
    const out = await assistantTurn([{ role: 'user', content: 'search' }]);
    assert.equal(out.ready, false);
    assert.match(out.reply, /I still need a Date of Order range/);
  });

  it('keeps previously confirmed fields even if the model forgets them, and sends the state note', async () => {
    respondWith({ reply: 'Which dates?', fields: {} });
    const out = await assistantTurn([{ role: 'user', content: 'dharwad' }], { db_bench: 'D' });
    assert.equal(out.fields.db_bench, 'D');
    assert.match(lastBody.contents[0].parts[0].text, /Current validated search fields.*"db_bench":"D"/);
  });

  it('does not nag about search fields once cases have been fetched', async () => {
    respondWith({ reply: 'Case 1 was disposed.', fields: {} });
    const out = await assistantTurn([{ role: 'user', content: 'status of case 1?' }], {}, [{ case_type: 'WP', case_no: '1', case_year: '2023' }]);
    assert.equal(out.reply, 'Case 1 was disposed.');
    assert.match(lastBody.systemInstruction.parts[0].text, /FETCHED CASES/);
  });

  it('gives a single focused case a much larger share of the prompt than one of many', async () => {
    const long = 'Order text. '.repeat(250); // ~3000 chars
    const one = { case_type: 'WP', case_no: '1', case_year: '2023', sections: { 'Daily Orders Information': long } };
    respondWith({ reply: 'ok', fields: {} });
    await assistantTurn([{ role: 'user', content: 'summarise' }], {}, [one]);
    const single = lastBody.systemInstruction.parts[0].text;
    assert.ok(single.includes(long.trim().slice(0, 2500)), 'single case keeps its long section');

    respondWith({ reply: 'ok', fields: {} });
    await assistantTurn([{ role: 'user', content: 'summarise' }], {}, [one, { ...one, case_no: '2' }]);
    assert.ok(!lastBody.systemInstruction.parts[0].text.includes(long.trim().slice(0, 2500)), 'many cases are squeezed');
  });

  it('keeps line breaks in the reply so headings and bullets survive', async () => {
    respondWith({ reply: '### Summary\n\n* **Status:** Disposed\n    * nested', fields: {} });
    const out = await assistantTurn([{ role: 'user', content: 'summarise' }], {}, [{ case_type: 'WP', case_no: '1', case_year: '2023' }]);
    assert.equal(out.reply, '### Summary\n\n* **Status:** Disposed\n    * nested');
  });

  it('surfaces a missing API key as an LlmError', async () => {
    const { LLM } = await import('../src/config.js');
    const saved = LLM.gemini.apiKey;
    LLM.gemini.apiKey = '';
    try {
      await assert.rejects(assistantTurn([{ role: 'user', content: 'hi' }]), /GEMINI_API_KEY is not set/);
    } finally { LLM.gemini.apiKey = saved; }
  });
});
