import { render, waitFor } from '@testing-library/react';
import { expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import App from '../src/App.jsx';
import { AuthProvider } from '../src/context/AuthContext.jsx';

const FORM_OPTIONS = {
  db_bench: [{ value: 'B', label: 'Principal Bench' }, { value: 'D', label: 'Dharwad Bench' }],
  case_types: [{ value: '144', label: 'WP - Writ Petition' }],
  case_years: [2024, 2023],
  coram: [{ value: '1', label: 'Single Bench' }],
  report_type: [{ value: 'none', label: 'None' }, { value: 'Y', label: 'Reported' }],
  sections: ['Case Information', 'Judgment PDF', 'Party Information', 'Daily Orders Information'],
};

export const USER = { id: 1, email: 'ann@example.com', name: 'Ann Rao', picture: null };

export const CASE = {
  case_type: 'WP', case_no: '10000', case_year: '2024', petitioner: 'Sri Ramesh', respondent: 'Infosys',
  case_information: 'Status: Pending',
  case_info_structured: { kind: 'fields', pairs: [['Status', 'Pending']] },
  sections: { 'Party Information': 'x', 'Daily Orders Information': 'y' },
  sections_structured: {
    'Party Information': { kind: 'tables', tables: [{ title: 'Respondent Details', headers: ['Name'], rows: [{ Name: 'Infosys Ltd' }] }] },
    'Daily Orders Information': { kind: 'narrative', text: 'Heard. Reserved.' },
  },
  judgment_pdf: null,
};

/** A WebSocket we can push messages into. */
export class FakeSocket {
  static instances = [];
  static autoOpen = true; // set false to open the socket by hand with open()
  constructor() { FakeSocket.instances.push(this); if (FakeSocket.autoOpen) setTimeout(() => this.onopen?.(), 0); }
  open() { this.onopen?.(); }
  close() { this.onclose?.(); }
  static push(message) { FakeSocket.instances.at(-1).onmessage?.({ data: JSON.stringify(message) }); }
}

/** Stub fetch with canned API answers; `calls` records every request. */
export function stubApi(overrides = {}) {
  const calls = [];
  const routes = {
    'GET /api/form-options': FORM_OPTIONS,
    'GET /api/logs/search': { entries: [] },
    'GET /api/logs/case_number': { entries: [] },
    'GET /api/auth/me': { user: USER },
    'GET /api/search/status': { is_running: false, mine: false, kind: null, job_id: null, last_job: null },
    'GET /api/history': { searches: [] },
    'POST /api/judges': { judges: [{ value: '7', label: 'JUSTICE X' }] },
    'POST /api/search': { started: true, message: 'Search started.' },
    'POST /api/case-number-search': { started: true, message: 'Search started.' },
    'POST /api/search/stop': { stopped: true },
    ...overrides,
  };
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const answer = routes[`${method} ${url}`];
    const status = answer === undefined ? 404 : 200;
    return new Response(JSON.stringify(answer ?? { error: 'not stubbed' }), { status });
  };
  return calls;
}

/** Resolves once the signed-in app has mounted (it only does after the server confirms who you are). */
export const ready = () => waitFor(() => expect(FakeSocket.instances.length).toBeGreaterThan(0));

export function renderAt(path, { pollMs = 60_000, autoOpen = true } = {}) {
  FakeSocket.instances = [];
  FakeSocket.autoOpen = autoOpen;
  globalThis.WebSocket = FakeSocket;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider><App pollMs={pollMs} /></AuthProvider>
    </MemoryRouter>,
  );
}
