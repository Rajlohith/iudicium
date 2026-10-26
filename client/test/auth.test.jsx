import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CASE, FakeSocket, USER, ready, renderAt, stubApi } from './helpers.jsx';

/** A stand-in for Google's sign-in library; `google.callback` is what Google calls with the credential. */
function fakeGoogle() {
  const google = { callback: null, renderButton: vi.fn(), initialize: vi.fn((cfg) => { google.callback = cfg.callback; }), disableAutoSelect: vi.fn() };
  window.google = { accounts: { id: google } };
  return google;
}

const signedOut = { 'GET /api/auth/me': { user: null }, 'GET /api/auth/config': { client_id: 'client-123' } };

describe('the login page', () => {
  it('is all a signed-out visitor gets, and loads nothing else', async () => {
    const calls = stubApi(signedOut);
    const google = fakeGoogle();
    renderAt('/search');
    await screen.findByText('Access is limited to authorised accounts.');
    await waitFor(() => expect(google.renderButton).toHaveBeenCalled());

    expect(google.initialize.mock.calls[0][0].client_id).toBe('client-123');
    expect(screen.queryByText('Detailed Search')).toBeNull(); // no navigation, no pages
    expect(screen.queryByRole('link')).toBeNull();
    expect(calls.map((c) => c.url).every((u) => u.startsWith('/api/auth/'))).toBe(true); // nothing but auth requests
    expect(FakeSocket.instances).toHaveLength(0); // no live connection either
  });

  it('signs in with the credential from Google and lands where the visitor was heading', async () => {
    stubApi(signedOut);
    const google = fakeGoogle();
    renderAt('/quick-search');
    await waitFor(() => expect(google.renderButton).toHaveBeenCalled());

    const calls = stubApi({ 'POST /api/auth/google': { user: USER } }); // from now on the API answers as a signed-in user
    await act(async () => { await google.callback({ credential: 'google-jwt-credential-123456' }); });

    expect(await screen.findByText('Quick Search', { selector: 'h1' })).toBeTruthy();
    expect(screen.getByText('Ann Rao')).toBeTruthy(); // name from the Google account, in the top bar
    expect(calls.find((c) => c.url === '/api/auth/google').body).toEqual({ credential: 'google-jwt-credential-123456' });
  });

  it('shows why an account was turned away', async () => {
    stubApi(signedOut);
    const google = fakeGoogle();
    renderAt('/');
    await waitFor(() => expect(google.renderButton).toHaveBeenCalled());

    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'eve@elsewhere.com is not authorised to use this site.', code: 'not_allowed' }), { status: 403 });
    await act(async () => { await google.callback({ credential: 'google-jwt-credential-123456' }); });

    expect((await screen.findByRole('alert')).textContent).toMatch(/eve@elsewhere\.com is not authorised/);
    expect(screen.queryByText('Home')).toBeNull(); // still on the login page
  });

  it('explains when Google sign-in has not been configured on the server', async () => {
    stubApi({ ...signedOut, 'GET /api/auth/config': { client_id: null } });
    renderAt('/');
    expect(await screen.findByText(/Google sign-in is not set up yet/)).toBeTruthy();
    expect(screen.getByText('GOOGLE_CLIENT_ID')).toBeTruthy();
  });
});

describe('signed-in session', () => {
  it('signing out returns to the login page and wipes what was saved in the browser', async () => {
    const calls = stubApi();
    sessionStorage.setItem('detailedSearchResults', '{"cases":[]}');
    renderAt('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(await screen.findByText('Access is limited to authorised accounts.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/auth/logout')).toBe(true);
    expect(sessionStorage.getItem('detailedSearchResults')).toBeNull();
  });

  it('an expired session sends the person back to the login page', async () => {
    stubApi({ 'GET /api/history': { searches: [{ id: 1, kind: 'quick', source: 'form', title: 'WP 1/2024 · Principal Bench', params: {}, status: 'done', case_count: 1, created_at: new Date().toISOString() }] } });
    const user = userEvent.setup();
    renderAt('/account');
    await ready();
    const button = await screen.findByRole('button', { name: /Delete: WP 1\/2024/ });

    // the server no longer recognises the session
    const base = globalThis.fetch;
    globalThis.fetch = async (url, init) => (init?.method === 'DELETE'
      ? new Response(JSON.stringify({ error: 'Please sign in.', code: 'unauthenticated' }), { status: 401 })
      : base(url, init));
    await user.click(button);
    expect(await screen.findByText('Access is limited to authorised accounts.')).toBeTruthy();
  });
});

const SEARCHES = [
  { id: 12, kind: 'detailed', source: 'assistant', title: 'Principal Bench · 01-01-2024 → 31-01-2024 · Respondent: Infosys', status: 'done', case_count: 7, error: null, created_at: '2026-10-20T10:00:00.000Z',
    params: { db_bench: 'B', from_date: '01-01-2024', to_date: '31-01-2024', respondent_name: 'Infosys', aliases: ['Wipro', 'TCS'], alias_field: 'respondname', judge: '7', included_sections: ['Party Information'], output_filename: 'mine' } },
  { id: 11, kind: 'quick', source: 'form', title: 'WP 48907/2023 · Dharwad Bench', status: 'cancelled', case_count: 1, error: null, created_at: '2026-10-19T09:00:00.000Z',
    params: { db_bench: 'D', case_type: '144', case_no: '48907', case_year: '2023', included_sections: null } },
  { id: 10, kind: 'quick', source: 'form', title: 'WP 1/2020 · Principal Bench', status: 'failed', case_count: null, error: 'site unreachable', created_at: '2026-10-18T09:00:00.000Z',
    params: { db_bench: 'B', case_type: '144', case_no: '1', case_year: '2020' } },
  { id: 9, kind: 'detailed', source: 'form', title: 'Dharwad Bench · still going', status: 'running', case_count: null, error: null, created_at: '2026-10-17T09:00:00.000Z', params: { db_bench: 'D' } },
];

describe('the account page', () => {
  it('shows who you are and every previous search, newest first', async () => {
    stubApi({ 'GET /api/history': { searches: SEARCHES } });
    const { container } = renderAt('/account');
    expect(await screen.findByText('Ann Rao', { selector: '.account-card__name' })).toBeTruthy();
    expect(screen.getByText('ann@example.com')).toBeTruthy();

    const titles = [...container.querySelectorAll('.history-item__title')].map((n) => n.textContent);
    expect(titles).toEqual(SEARCHES.map((s) => s.title));
    expect(screen.getByText('via AI Assistant')).toBeTruthy();
    expect(screen.getAllByText('via Form')).toHaveLength(3);
    expect(screen.getByText('Completed')).toBeTruthy();
    expect(screen.getByText('Stopped')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByText(/7 cases/)).toBeTruthy();
    expect(screen.getByText(/site unreachable/)).toBeTruthy();
  });

  it('says so when there is no history yet', async () => {
    stubApi();
    renderAt('/account');
    expect(await screen.findByText(/No searches yet/)).toBeTruthy();
  });

  it('"Run again" on a Detailed Search opens it, fills the form and runs exactly the same search', async () => {
    const calls = stubApi({ 'GET /api/history': { searches: SEARCHES } });
    const user = userEvent.setup();
    const { container } = renderAt('/account');
    await screen.findByText(SEARCHES[0].title);
    await user.click(within(container.querySelectorAll('.history-item')[0]).getByRole('button', { name: /Run again/ }));

    expect(await screen.findByText('Detailed Search', { selector: 'h1' })).toBeTruthy();
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/search')).toBe(true));
    const posted = calls.find((c) => c.method === 'POST' && c.url === '/api/search').body;
    expect(posted).toEqual(SEARCHES[0].params); // identical to the saved search

    // ...and the form shows what is being run
    await waitFor(() => expect(container.querySelector('#fromDate').value).toBe('2024-01-01'));
    expect(container.querySelector('#toDate').value).toBe('2024-01-31');
    expect(container.querySelector('#respName').value).toBe('Infosys');
    expect(container.querySelector('#aliases').value).toBe('Wipro\nTCS');
    expect(container.querySelector('#outputFilename').value).toBe('mine');
    expect(screen.getByRole('button', { name: /Run Search/ }).disabled).toBe(true); // it is running
    expect(calls.filter((c) => c.method === 'POST' && c.url === '/api/search')).toHaveLength(1); // only once
  });

  it('"Run again" on a Quick Search opens Quick Search and runs it', async () => {
    const calls = stubApi({ 'GET /api/history': { searches: SEARCHES } });
    const user = userEvent.setup();
    const { container } = renderAt('/account');
    await screen.findByText(SEARCHES[1].title);
    await user.click(within(container.querySelectorAll('.history-item')[1]).getByRole('button', { name: /Run again/ }));

    expect(await screen.findByText('Quick Search', { selector: 'h1' })).toBeTruthy();
    await waitFor(() => expect(calls.some((c) => c.url === '/api/case-number-search' && c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.url === '/api/case-number-search').body).toEqual(SEARCHES[1].params);
    await waitFor(() => expect(container.querySelector('#caseNo').value).toBe('48907'));
  });

  it('an assistant search runs in the matching search page, and its results appear there', async () => {
    stubApi({ 'GET /api/history': { searches: SEARCHES } });
    const user = userEvent.setup();
    const { container } = renderAt('/account');
    await screen.findByText(SEARCHES[0].title);
    await user.click(within(container.querySelectorAll('.history-item')[0]).getByRole('button', { name: /Run again/ }));
    await screen.findByText('Detailed Search', { selector: 'h1' });
    await act(async () => {
      FakeSocket.push({ type: 'done', payload: { kind: 'detailed', output_filename: 'mine.xlsx', case_count: 1, duplicates_skipped: 0, cancelled: false, cases: [CASE] } });
    });
    expect(await screen.findByText('1 unique case(s) found, 0 duplicate(s) skipped.')).toBeTruthy();
  });

  it('a search that is still running cannot be re-run or deleted', async () => {
    stubApi({ 'GET /api/history': { searches: SEARCHES } });
    const { container } = renderAt('/account');
    await screen.findByText(SEARCHES[3].title);
    const running = container.querySelectorAll('.history-item')[3];
    expect(within(running).getByRole('button', { name: /Run again/ }).disabled).toBe(true);
  });

  it('deletes one search, and clears them all after confirming', async () => {
    const calls = stubApi({ 'GET /api/history': { searches: SEARCHES.slice(0, 3) }, 'DELETE /api/history/11': { deleted: true }, 'DELETE /api/history': { deleted: 2 } });
    const user = userEvent.setup();
    renderAt('/account');
    await screen.findByText(SEARCHES[1].title);

    await user.click(screen.getByRole('button', { name: `Delete: ${SEARCHES[1].title}` }));
    await waitFor(() => expect(screen.queryByText(SEARCHES[1].title)).toBeNull());
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/history/11')).toBe(true);

    window.confirm = () => false;
    await user.click(screen.getByRole('button', { name: /Clear all/ }));
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/history')).toBe(false); // declined

    window.confirm = () => true;
    stubApi({ 'GET /api/history': { searches: [] }, 'DELETE /api/history': { deleted: 2 } });
    await user.click(screen.getByRole('button', { name: /Clear all/ }));
    expect(await screen.findByText(/No searches yet/)).toBeTruthy();
  });
});
