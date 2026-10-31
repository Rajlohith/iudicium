import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { CASE, FakeSocket, ready, renderAt, stubApi } from './helpers.jsx';

describe('routing and layout', () => {
  it.each([
    ['/', 'Karnataka High Court Case Research Tool'],
    ['/guide', 'AI Assistant'],
    ['/faq', 'Frequently Asked Questions'],
    ['/search', 'Select Bench'],
    ['/quick-search', 'Case Number'],
    ['/assistant', /Describe the case search/],
  ])('renders %s', async (path, text) => {
    stubApi();
    renderAt(path);
    await ready();
    expect(await screen.findAllByText(text)).not.toHaveLength(0);
    expect(screen.getAllByRole('link', { name: /Detailed Search/ }).length).toBeGreaterThan(0);
  });

  it('shows the live connection status', async () => {
    stubApi();
    renderAt('/', { autoOpen: false });
    await ready();
    expect(screen.getByText('Reconnecting…')).toBeTruthy(); // socket created but not open yet
    act(() => FakeSocket.instances.at(-1).open());
    expect(await screen.findByText('Connected')).toBeTruthy();
  });

  it('unknown URLs fall back to Home', async () => {
    stubApi();
    renderAt('/nope');
    await ready();
    expect(await screen.findByText('Karnataka High Court Case Research Tool')).toBeTruthy();
  });
});

describe('guide and faq accordions', () => {
  it('toggles an FAQ answer', async () => {
    stubApi();
    const { container } = renderAt('/faq');
    await ready();
    await screen.findByText('FAQ', { selector: 'h1' });
    const item = container.querySelector('.faq-item');
    expect(item.classList.contains('open')).toBe(false);
    fireEvent.click(item.querySelector('.faq-item__q'));
    expect(item.classList.contains('open')).toBe(true);
  });

  it('toggles a guide block', async () => {
    stubApi();
    const { container } = renderAt('/guide');
    await ready();
    await screen.findByText('Guide', { selector: 'h1' });
    const block = container.querySelector('.guide-block');
    const was = block.classList.contains('collapsed');
    fireEvent.click(block.querySelector('.guide-block__header'));
    expect(block.classList.contains('collapsed')).toBe(!was);
  });
});

describe('Detailed Search', () => {
  it('validates, submits the right payload, streams progress and shows results', async () => {
    const calls = stubApi();
    const user = userEvent.setup();
    const { container } = renderAt('/search');
    await ready();
    window.alert = () => {};

    await screen.findByRole('option', { name: 'Principal Bench' });
    await user.selectOptions(container.querySelector('#dbBench'), 'B');
    await waitFor(() => expect(calls.some((c) => c.url === '/api/judges')).toBe(true));
    await screen.findAllByRole('option', { name: 'JUSTICE X' });

    fireEvent.change(container.querySelector('#fromDate'), { target: { value: '2024-01-31' } });
    fireEvent.change(container.querySelector('#toDate'), { target: { value: '2024-03-31' } });
    await user.type(container.querySelector('#aliases'), 'Infosys, Wipro');
    await user.click(screen.getByRole('button', { name: /Run Search/ }));

    const post = calls.find((c) => c.url === '/api/search' && c.method === 'POST');
    expect(post.body).toMatchObject({
      db_bench: 'B', from_date: '31-01-2024', to_date: '31-03-2024', aliases: ['Infosys', 'Wipro'],
      alias_field: 'respondname', included_sections: null, judge: null, report_type: 'none',
    });
    expect(screen.getByRole('button', { name: /Run Search/ }).disabled).toBe(true);

    await act(async () => {
      FakeSocket.push({ type: 'log', payload: 'Opening site' });
      FakeSocket.push({ type: 'case_progress', payload: { done: 2, total: 4, label: 'Infosys' } });
    });
    expect(await screen.findByText(/Opening site/)).toBeTruthy();
    expect(screen.getByText(/Extracting case 2 of 4 for 'Infosys'/)).toBeTruthy();

    await act(async () => {
      FakeSocket.push({ type: 'done', payload: { kind: 'detailed', output_filename: 'r.xlsx', case_count: 1, duplicates_skipped: 0, cancelled: false, cases: [CASE] } });
    });
    expect(await screen.findByText('1 unique case(s) found, 0 duplicate(s) skipped.')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Excel/ }).getAttribute('href')).toBe('/outputs/r.xlsx');
    expect(screen.getByRole('button', { name: /Run Search/ }).disabled).toBe(false);

    // Case card -> section -> table contents are rendered lazily
    expect(screen.queryByText('Infosys Ltd')).toBeNull();
    await user.click(screen.getByText('WP 10000/2024'));
    await user.click(within(container.querySelector('.results-card')).getByText('Party Information'));
    expect(await screen.findByText('Infosys Ltd')).toBeTruthy();
    expect(screen.getByText('Respondent Details')).toBeTruthy();
  });

  it('refuses to submit without bench or dates, and surfaces server errors in the log', async () => {
    const calls = stubApi({ 'POST /api/search': undefined });
    const user = userEvent.setup();
    const alerts = [];
    window.alert = (m) => alerts.push(m);
    const { container } = renderAt('/search');
    await ready();
    await screen.findByRole('option', { name: 'Principal Bench' });

    container.querySelector('form').noValidate = true; // let our own validation speak
    await user.click(screen.getByRole('button', { name: /Run Search/ }));
    expect(alerts[0]).toMatch(/select a bench/i);

    await user.selectOptions(container.querySelector('#dbBench'), 'B');
    await user.click(screen.getByRole('button', { name: /Run Search/ }));
    expect(alerts[1]).toMatch(/Date of Order range/);
    expect(calls.some((c) => c.url === '/api/search' && c.method === 'POST')).toBe(false);

    fireEvent.change(container.querySelector('#fromDate'), { target: { value: '2024-01-01' } });
    fireEvent.change(container.querySelector('#toDate'), { target: { value: '2024-01-02' } });
    await user.click(screen.getByRole('button', { name: /Run Search/ }));
    expect(await screen.findByText(/not stubbed/)).toBeTruthy(); // 404 body message lands in the activity log
    expect(screen.getByRole('button', { name: /Run Search/ }).disabled).toBe(false);
  });

  it('filters and sorts results', async () => {
    stubApi();
    const user = userEvent.setup();
    renderAt('/search');
    await ready();
    const other = { ...CASE, case_no: '20000', case_year: '2023', petitioner: 'Zed Corp', respondent: 'State' };
    await act(async () => {
      FakeSocket.push({ type: 'done', payload: { kind: 'detailed', output_filename: 'r.zip', case_count: 2, duplicates_skipped: 1, cancelled: false, cases: [CASE, other] } });
    });
    expect(await screen.findByText('Showing 2 of 2 case(s)')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Judgment PDFs/ })).toBeTruthy(); // .zip label

    await user.type(screen.getByPlaceholderText('Parties, case no…'), 'zed corp'); // spaces must survive typing
    expect(screen.getByText('Showing 1 of 2 case(s)')).toBeTruthy();
    expect(screen.getByText('WP 20000/2023')).toBeTruthy();
    expect(screen.queryByText('WP 10000/2024')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(screen.getByText('Showing 2 of 2 case(s)')).toBeTruthy();

    const cards = () => [...document.querySelectorAll('.case-card__title')].map((n) => n.textContent);
    expect(cards()).toEqual(['WP 10000/2024', 'WP 20000/2023']); // newest year first
    await user.selectOptions(screen.getByLabelText('Sort by'), 'case_no_desc');
    expect(cards()).toEqual(['WP 20000/2023', 'WP 10000/2024']);
  });

  it('restores results saved by a search that finished while the person was elsewhere', async () => {
    stubApi();
    renderAt('/');
    await ready();
    await act(async () => {
      FakeSocket.push({ type: 'done', payload: { kind: 'detailed', output_filename: 'late.xlsx', case_count: 1, duplicates_skipped: 0, cancelled: false, cases: [CASE] } });
    });
    const again = renderAt('/search');
    await ready();
    expect(await within(again.container).findByText(/restored from this session/)).toBeTruthy();
  });

  it('picks up a search already running on the server', async () => {
    stubApi({ 'GET /api/search/status': { is_running: true, mine: true, kind: 'detailed', job_id: 3, last_job: null } });
    renderAt('/search');
    await ready();
    expect(await screen.findByText('Fetching cases…')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Stop/ }).disabled).toBe(false);
  });

  it('ignores a finished quick search on the detailed page', async () => {
    stubApi();
    renderAt('/search');
    await ready();
    await act(async () => {
      FakeSocket.push({ type: 'done', payload: { kind: 'quick', output_filename: 'q.xlsx', case_count: 1, duplicates_skipped: 0, cancelled: false, cases: [CASE] } });
    });
    expect(screen.queryByText('Results')).toBeNull();
  });
});

describe('Quick Search', () => {
  it('submits and renders the single case without the filter sidebar', async () => {
    const calls = stubApi();
    const user = userEvent.setup();
    const { container } = renderAt('/quick-search');
    await ready();
    await screen.findByRole('option', { name: 'Principal Bench' });

    await user.selectOptions(container.querySelector('#dbBench'), 'B');
    await user.selectOptions(container.querySelector('#caseType'), '144');
    await user.type(container.querySelector('#caseNo'), '12a34');
    await user.selectOptions(container.querySelector('#caseYear'), '2024');
    expect(container.querySelector('#caseNo').value).toBe('1234'); // digits only
    await user.click(screen.getByRole('button', { name: /Run Search/ }));

    expect(calls.find((c) => c.url === '/api/case-number-search').body).toMatchObject({
      db_bench: 'B', case_type: '144', case_no: '1234', case_year: '2024', included_sections: null,
    });

    await act(async () => {
      FakeSocket.push({ type: 'done', payload: { kind: 'quick', output_filename: 'q.xlsx', case_count: 1, duplicates_skipped: 0, cancelled: false, cases: [CASE] } });
    });
    expect(await screen.findByText('1 case(s) found.')).toBeTruthy();
    expect(screen.queryByText('Filters')).toBeNull();
  });

  it('prefills from the assistant hand-off and then discards it', async () => {
    stubApi();
    sessionStorage.setItem('assistantPrefill', JSON.stringify({ db_bench: 'D', case_type: '144', case_no: '48907', case_year: '2023' }));
    const { container } = renderAt('/quick-search');
    await ready();
    await screen.findByRole('option', { name: 'Dharwad Bench' });
    await waitFor(() => expect(container.querySelector('#dbBench').value).toBe('D'));
    expect(container.querySelector('#caseNo').value).toBe('48907');
    expect(sessionStorage.getItem('assistantPrefill')).toBeNull();
  });
});

describe('Summarise button', () => {
  const reply = { reply: '**Summary** of the case.', fields: {}, display: [], missing: [], ready: false, mode: null, warnings: [] };

  it.each([
    ['Detailed Search', '/search', 'detailed'],
    ['Quick Search', '/quick-search', 'quick'],
  ])('%s: sends the case to the assistant page, which asks for a summary and keeps the case for follow-ups', async (_name, path, kind) => {
    const calls = stubApi({ 'POST /api/assistant': reply });
    const user = userEvent.setup();
    renderAt(path);
    await ready();

    await act(async () => {
      FakeSocket.push({ type: 'done', payload: { kind, output_filename: 'r.xlsx', case_count: 1, duplicates_skipped: 0, cancelled: false, cases: [CASE] } });
    });
    const card = (await screen.findByText('WP 10000/2024')).closest('.case-card');
    await user.click(within(card).getByRole('button', { name: /Summarise/ }));

    // The card did not expand, and we are now on the assistant page with the summary requested.
    expect(await screen.findByText(/Summary/)).toBeTruthy();
    expect(screen.getByText(/Chatting about/)).toBeTruthy();
    const first = calls.filter((c) => c.url === '/api/assistant')[0].body;
    expect(first.messages[0].content).toMatch(/^Summarise case WP 10000\/2024/);
    expect(first.cases).toHaveLength(1);
    expect(first.cases[0]).toMatchObject({ case_no: '10000', respondent: 'Infosys' });
    expect(first.cases[0].sections_structured).toBeUndefined(); // trimmed

    // Follow-up questions keep carrying that case.
    await user.type(screen.getByPlaceholderText('Type a message…'), 'who is the respondent?{Enter}');
    await waitFor(() => expect(calls.filter((c) => c.url === '/api/assistant')).toHaveLength(2));
    const second = calls.filter((c) => c.url === '/api/assistant')[1].body;
    expect(second.messages).toHaveLength(3);
    expect(second.cases[0]).toMatchObject({ case_no: '10000' });
  });
});

describe('Assistant', () => {
  it('chats, shows a parameter card, runs the search and reports the outcome', async () => {
    const parameterReply = {
      reply: 'Ready — press Run search.',
      fields: { db_bench: 'B', case_type: '144', case_no: '1', case_year: '2024' },
      display: [{ key: 'Bench', value: 'Principal Bench' }, { key: 'Case number', value: '1' }],
      missing: [], ready: true, mode: 'quick', warnings: [],
    };
    const calls = stubApi({
      'POST /api/assistant': parameterReply,
      'POST /api/assistant/run': { started: true, message: 'Search started.', mode: 'quick' },
    });
    const user = userEvent.setup();
    renderAt('/assistant');
    await ready();

    await user.type(screen.getByPlaceholderText('Type a message…'), 'WP 1 of 2024 Bengaluru{Enter}');
    expect(await screen.findByText('Ready — press Run search.')).toBeTruthy();
    expect(calls.find((c) => c.url === '/api/assistant').body.messages).toEqual([{ role: 'user', content: 'WP 1 of 2024 Bengaluru' }]);
    expect(document.querySelector('.param-card__mode').textContent).toBe('Quick Search'); // mode badge on the card

    await user.click(screen.getByRole('button', { name: /Run search/ }));
    expect(calls.find((c) => c.url === '/api/assistant/run').body.fields).toMatchObject({ db_bench: 'B', case_no: '1' });
    expect(await screen.findByText('Running Quick Search…')).toBeTruthy();

    await act(async () => {
      FakeSocket.push({ type: 'log', payload: 'Searching case…' });
      FakeSocket.push({ type: 'done', payload: { kind: 'quick', output_filename: 'q.xlsx', case_count: 1, duplicates_skipped: 0, cancelled: false, cases: [CASE] } });
    });
    expect(await screen.findByText('Results overview')).toBeTruthy();
    expect(screen.getByText(/Ask me anything about these cases/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open in cases view/ }).getAttribute('href')).toBe('/quick-search');

    // The next question carries the fetched cases so the model can answer about them
    await user.type(screen.getByPlaceholderText('Type a message…'), 'who is the respondent?{Enter}');
    await waitFor(() => expect(calls.filter((c) => c.url === '/api/assistant')).toHaveLength(2));
    const second = calls.filter((c) => c.url === '/api/assistant')[1].body;
    expect(second.cases[0]).toMatchObject({ case_no: '10000', respondent: 'Infosys' });
    expect(second.cases[0].sections_structured).toBeUndefined(); // trimmed
  });

  it('renders model text safely (markdown yes, HTML no)', async () => {
    stubApi({ 'POST /api/assistant': { reply: '**Bold** and <img src=x onerror=alert(1)>\n\n* one\n* two', fields: {}, display: [], missing: [], ready: false, mode: null, warnings: [] } });
    const user = userEvent.setup();
    const { container } = renderAt('/assistant');
    await ready();
    await user.type(screen.getByPlaceholderText('Type a message…'), 'hi{Enter}');
    expect(await screen.findByText('Bold')).toBeTruthy();
    expect(container.querySelector('strong').textContent).toBe('Bold');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('shows a friendly message when the assistant request fails', async () => {
    stubApi({ 'POST /api/assistant': undefined });
    const user = userEvent.setup();
    renderAt('/assistant');
    await ready();
    await user.type(screen.getByPlaceholderText('Type a message…'), 'hello{Enter}');
    expect(await screen.findByText(/couldn't reach the assistant/)).toBeTruthy();
  });
});

describe('when WebSocket messages never arrive', () => {
  const finishedStatus = (job) => ({ is_running: false, kind: null, job_id: null, last_job: { ended_ago_ms: 5000, ...job } });

  it('a failed search still shows its error in the activity log', async () => {
    let phase = 'idle';
    const calls = stubApi();
    const base = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (url === '/api/search/status') {
        const body = phase === 'idle' ? { is_running: false, kind: null, job_id: null, last_job: null }
          : finishedStatus({ id: 1, kind: 'detailed', state: 'error', message: "This Python is missing: pytesseract." });
        return new Response(JSON.stringify(body), { status: 200 });
      }
      return base(url, init);
    };
    const user = userEvent.setup();
    const { container } = renderAt('/search', { pollMs: 40 });
    await ready();
    window.alert = () => {};
    await screen.findByRole('option', { name: 'Principal Bench' });
    await user.selectOptions(container.querySelector('#dbBench'), 'B');
    fireEvent.change(container.querySelector('#fromDate'), { target: { value: '2024-01-01' } });
    fireEvent.change(container.querySelector('#toDate'), { target: { value: '2024-01-31' } });
    await new Promise((r) => setTimeout(r, 100)); // let the baseline poll run while idle
    await user.click(screen.getByRole('button', { name: /Run Search/ }));
    phase = 'failed'; // the server's job failed; no WebSocket frame is ever sent
    expect(await screen.findByText(/ERROR: This Python is missing: pytesseract/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Run Search/ }).disabled).toBe(false);
    expect(calls.some((c) => c.url === '/api/search' && c.method === 'POST')).toBe(true);
  });

  it('a finished search still delivers its results', async () => {
    let phase = 'idle';
    const calls = stubApi({ 'GET /api/search/result': { kind: 'detailed', output_filename: 'p.xlsx', case_count: 1, duplicates_skipped: 0, cancelled: false, cases: [CASE] } });
    const base = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (url === '/api/search/status') {
        const body = phase === 'idle' ? { is_running: false, kind: null, job_id: null, last_job: null }
          : finishedStatus({ id: 2, kind: 'detailed', state: 'done', message: null });
        return new Response(JSON.stringify(body), { status: 200 });
      }
      return base(url, init);
    };
    const user = userEvent.setup();
    const { container } = renderAt('/search', { pollMs: 40 });
    await ready();
    window.alert = () => {};
    await screen.findByRole('option', { name: 'Principal Bench' });
    await user.selectOptions(container.querySelector('#dbBench'), 'B');
    fireEvent.change(container.querySelector('#fromDate'), { target: { value: '2024-01-01' } });
    fireEvent.change(container.querySelector('#toDate'), { target: { value: '2024-01-31' } });
    await new Promise((r) => setTimeout(r, 100));
    await user.click(screen.getByRole('button', { name: /Run Search/ }));
    phase = 'done';
    expect(await screen.findByText('1 unique case(s) found, 0 duplicate(s) skipped.')).toBeTruthy();
    expect(calls.length).toBeGreaterThan(0);
  });

  it('does not replay a job that finished before the page loaded', async () => {
    stubApi({ 'GET /api/search/status': finishedStatus({ id: 7, kind: 'detailed', state: 'error', message: 'old failure' }) });
    renderAt('/search', { pollMs: 40 });
    await ready();
    await screen.findByRole('option', { name: 'Principal Bench' });
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByText(/old failure/)).toBeNull();
  });
});
