import { useMemo, useState } from 'react';

import { exportMarkdown } from '../utils/exportMarkdown.js';
import { exportPdf } from '../utils/exportPdf.js';
import Icon from './Icon.jsx';
import { CaseCard, sectionCount } from './SectionViews.jsx';

const SORTS = [
  ['year_desc', 'Case Year (newest first)'],
  ['year_asc', 'Case Year (oldest first)'],
  ['case_no_asc', 'Case No (low to high)'],
  ['case_no_desc', 'Case No (high to low)'],
  ['petitioner_az', 'Petitioner (A–Z)'],
  ['most_data', 'Most detail first'],
];

const EMPTY_FILTERS = { search: '', petitioner: '', respondent: '', types: [], years: [], hasJudgment: false, hasOrders: false };

const num = (v) => parseInt(v, 10) || 0;

function sortCases(cases, mode) {
  const copy = [...cases];
  switch (mode) {
    case 'year_asc': return copy.sort((a, b) => num(a.case_year) - num(b.case_year));
    case 'case_no_asc': return copy.sort((a, b) => num(a.case_no) - num(b.case_no));
    case 'case_no_desc': return copy.sort((a, b) => num(b.case_no) - num(a.case_no));
    case 'petitioner_az': return copy.sort((a, b) => (a.petitioner || '').localeCompare(b.petitioner || ''));
    case 'most_data': return copy.sort((a, b) => b._sectionCount - a._sectionCount);
    default: return copy.sort((a, b) => num(b.case_year) - num(a.case_year));
  }
}

const norm = (s) => s.trim().toLowerCase();

function matches(c, f) {
  if (f.types.length && !f.types.includes(c.case_type || 'Unknown')) return false;
  if (f.years.length && !f.years.includes(c.case_year || 'Unknown')) return false;
  if (f.hasJudgment && !(c.sections || {})['Judgment Information']) return false;
  if (f.hasOrders && !(c.sections || {})['Daily Orders Information']) return false;
  if (norm(f.petitioner) && !(c.petitioner || '').toLowerCase().includes(norm(f.petitioner))) return false;
  if (norm(f.respondent) && !(c.respondent || '').toLowerCase().includes(norm(f.respondent))) return false;
  if (norm(f.search)) {
    const haystack = [c.case_type, c.case_no, c.case_year, c.petitioner, c.respondent].join(' ').toLowerCase();
    if (!haystack.includes(norm(f.search))) return false;
  }
  return true;
}

const countBy = (cases, pick) => {
  const counts = new Map();
  cases.forEach((c) => {
    const key = pick(c) || 'Unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
};

function CheckboxGroup({ entries, selected, onToggle }) {
  if (!entries.length) return <p className="hint" style={{ margin: 0 }}>None</p>;
  return entries.map(([value, count]) => (
    <label key={value} className="checkbox-row">
      <input type="checkbox" checked={selected.includes(value)} onChange={() => onToggle(value)} />
      <span>{value}</span>
      <span className="count">{count}</span>
    </label>
  ));
}

/**
 * Finished results: download buttons, then (for Detailed Search) filters,
 * sorting and the expandable case cards. `filters={false}` renders just the
 * cards, which is all a single-case Quick Search needs.
 */
export default function ResultsPanel({ results, onClear, filters: withFilters = true }) {
  const { cases: rawCases, summary, downloadHref, filename } = results;
  const cases = useMemo(() => rawCases.map((c) => ({ ...c, _sectionCount: sectionCount(c) })), [rawCases]);

  const [f, setF] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState('year_desc');
  const patch = (changes) => setF((prev) => ({ ...prev, ...changes }));
  const toggle = (key) => (value) =>
    setF((prev) => ({ ...prev, [key]: prev[key].includes(value) ? prev[key].filter((v) => v !== value) : [...prev[key], value] }));

  const typeEntries = useMemo(() => [...countBy(cases, (c) => c.case_type)].sort((a, b) => b[1] - a[1]), [cases]);
  const yearEntries = useMemo(() => [...countBy(cases, (c) => c.case_year)].sort((a, b) => String(b[0]).localeCompare(String(a[0]))), [cases]);
  const visible = useMemo(() => sortCases(cases.filter((c) => matches(c, f)), sort), [cases, f, sort]);

  const chips = [
    ...f.types.map((v) => ({ label: `Type: ${v}`, clear: () => toggle('types')(v) })),
    ...f.years.map((v) => ({ label: `Year: ${v}`, clear: () => toggle('years')(v) })),
    f.hasJudgment && { label: 'Has Judgment', clear: () => patch({ hasJudgment: false }) },
    f.hasOrders && { label: 'Has Daily Orders', clear: () => patch({ hasOrders: false }) },
    norm(f.petitioner) && { label: `Petitioner: "${norm(f.petitioner)}"`, clear: () => patch({ petitioner: '' }) },
    norm(f.respondent) && { label: `Respondent: "${norm(f.respondent)}"`, clear: () => patch({ respondent: '' }) },
    norm(f.search) && { label: `"${norm(f.search)}"`, clear: () => patch({ search: '' }) },
  ].filter(Boolean);

  const isZip = (filename || '').toLowerCase().endsWith('.zip');

  return (
    <section className="card results-card">
      <div className="card-header">
        <div className="results-header-left">
          <h2>Results</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClear} title="Clear results">
            <Icon name="x-circle" /> Clear
          </button>
        </div>
        <div className="download-options">
          <a className="btn btn-outline btn-sm" href={downloadHref} download>
            {isZip ? <><Icon name="folder-archive" /> Excel + Judgment PDFs (.zip)</> : <><Icon name="file-spreadsheet" /> Excel</>}
          </a>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => exportPdf(cases)}>
            <Icon name="file-text" /> PDF
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => exportMarkdown(cases)}>
            <Icon name="file-code" /> Markdown
          </button>
        </div>
      </div>
      <p className="results-summary">{summary}</p>

      <div className="results-shell" style={withFilters ? undefined : { gridTemplateColumns: '1fr' }}>
        {withFilters && (
          <aside className="filters-panel">
            <div className="filters-panel__header">
              <h3>Filters</h3>
              <button type="button" className="link-btn" onClick={() => { setF(EMPTY_FILTERS); setSort('year_desc'); }}>
                Clear all
              </button>
            </div>

            <div className="filter-group">
              <label className="field-label-sm">Search within results</label>
              <div className="input-icon-wrap" style={{ position: 'relative', overflow: 'hidden' }}>
                <Icon
                  name="search"
                  style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 13, height: 13, color: 'var(--text-muted)', pointerEvents: 'none', zIndex: 1 }}
                />
                <input
                  type="text"
                  placeholder="Parties, case no…"
                  value={f.search}
                  onChange={(e) => patch({ search: e.target.value })}
                  style={{ paddingLeft: 30, fontSize: 12.5, paddingTop: 8, paddingBottom: 8 }}
                />
              </div>
            </div>

            <div className="filter-group">
              <label className="field-label-sm">Petitioner</label>
              <input type="text" className="filter-text-input" placeholder="Contains…" value={f.petitioner}
                onChange={(e) => patch({ petitioner: e.target.value })} />
            </div>

            <div className="filter-group">
              <label className="field-label-sm">Respondent</label>
              <input type="text" className="filter-text-input" placeholder="Contains…" value={f.respondent}
                onChange={(e) => patch({ respondent: e.target.value })} />
            </div>

            <div className="filter-group">
              <label className="field-label-sm">Case Type</label>
              <div className="checkbox-list"><CheckboxGroup entries={typeEntries} selected={f.types} onToggle={toggle('types')} /></div>
            </div>

            <div className="filter-group">
              <label className="field-label-sm">Case Year</label>
              <div className="checkbox-list"><CheckboxGroup entries={yearEntries} selected={f.years} onToggle={toggle('years')} /></div>
            </div>

            <div className="filter-group">
              <label className="field-label-sm">Content</label>
              <div className="checkbox-list">
                <label className="checkbox-row">
                  <input type="checkbox" checked={f.hasJudgment} onChange={(e) => patch({ hasJudgment: e.target.checked })} />
                  Has Judgment Information
                </label>
                <label className="checkbox-row">
                  <input type="checkbox" checked={f.hasOrders} onChange={(e) => patch({ hasOrders: e.target.checked })} />
                  Has Daily Orders
                </label>
              </div>
            </div>
          </aside>
        )}

        <div className="results-main">
          {withFilters && (
            <>
              <div className="results-toolbar">
                <div className="active-chips">
                  {chips.map((chip) => (
                    <span key={chip.label} className="chip">
                      {chip.label}{' '}
                      <button type="button" onClick={chip.clear}><Icon name="x" /></button>
                    </span>
                  ))}
                </div>
                <div className="sort-control">
                  <label className="field-label-sm" htmlFor="sortSelect">Sort by</label>
                  <select id="sortSelect" value={sort} onChange={(e) => setSort(e.target.value)}>
                    {SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
              </div>
              <p className="results-count">{`Showing ${visible.length} of ${cases.length} case(s)`}</p>
            </>
          )}
          <div className="results-list">
            {visible.length
              ? visible.map((c, i) => <CaseCard key={`${c.case_type}-${c.case_no}-${c.case_year}-${i}`} c={c} />)
              : <p className="hint">{cases.length ? 'No cases match the current filters.' : 'No cases to show.'}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
