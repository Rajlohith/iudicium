import { useState } from 'react';

import Icon from './Icon.jsx';

// ----------------------------------------------------------------------
// Helpers shared with the exports
// ----------------------------------------------------------------------

/**
 * One ordered list of [name, flatText, structured] combining Case Information
 * with every other section. flatText is only a fallback for results that
 * predate the structured data.
 */
export function collectSections(c) {
  const entries = [];
  if (c.case_info_structured || c.case_information) {
    entries.push(['Case Information', c.case_information || '', c.case_info_structured || null]);
  }
  const names = new Set([...Object.keys(c.sections || {}), ...Object.keys(c.sections_structured || {})]);
  names.forEach((name) => {
    const text = (c.sections || {})[name] || '';
    const structured = (c.sections_structured || {})[name] || null;
    if (text || structured) entries.push([name, text, structured]);
  });
  return entries;
}

/** The site's own column order first, then any extra keys a row carries (e.g. a folded-in "Notes"). */
export function tableColumns(table) {
  const cols = [];
  (table.headers || []).forEach((h) => {
    if (h && !cols.includes(h)) cols.push(h);
  });
  (table.rows || []).forEach((row) => {
    Object.keys(row).forEach((k) => {
      if (!cols.includes(k)) cols.push(k);
    });
  });
  return cols;
}

export function sectionRowCount(structured) {
  if (!structured) return 0;
  if (structured.kind === 'tables') return (structured.tables || []).reduce((sum, t) => sum + (t.rows || []).length, 0);
  if (structured.kind === 'fields') return (structured.pairs || []).length;
  return 0;
}

export const sectionCount = (c) => (c.case_information ? 1 : 0) + Object.keys(c.sections || {}).length;

// ----------------------------------------------------------------------
// Rendering. Driven entirely by the structure the scraper read from the
// page: tables render as tables with whatever columns they have, fields as
// a two-column table, anything else as plain text.
// ----------------------------------------------------------------------

const NoData = () => (
  <p className="hint" style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
    No data recorded.
  </p>
);

/** Text with line breaks preserved. */
function Multiline({ text }) {
  const lines = String(text ?? '').split('\n');
  return lines.map((line, i) => (
    <span key={i}>
      {i > 0 && <br />}
      {line}
    </span>
  ));
}

function Narrative({ text }) {
  if (!text || !text.trim()) return <NoData />;
  return <pre className="section-narrative">{text.trim()}</pre>;
}

function FieldsTable({ pairs }) {
  if (!pairs.length) return <NoData />;
  return (
    <table className="section-fields">
      <tbody>
        {pairs.map(([k, v], i) => (
          <tr key={i}>
            <td className="field-key">{k}</td>
            <td className="field-val"><Multiline text={v} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StructuredTable({ table }) {
  const cols = tableColumns(table);
  if (!cols.length || !(table.rows || []).length) return null;
  return (
    <>
      {table.title && <div className="party-block-title">{table.title}</div>}
      <table className="party-table">
        <thead>
          <tr>{cols.map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i}>
              {cols.map((h) => (
                <td key={h}><Multiline text={row[h] || ''} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function SectionBody({ text, structured }) {
  if (!structured) return <Narrative text={text} />;
  if (structured.kind === 'tables') {
    const tables = (structured.tables || []).map((t, i) => <StructuredTable key={i} table={t} />);
    return tables.some(Boolean) ? tables : <NoData />;
  }
  if (structured.kind === 'fields') return <FieldsTable pairs={structured.pairs || []} />;
  if (structured.kind === 'narrative') return <Narrative text={structured.text || ''} />;
  return <NoData />;
}

function SectionItem({ title, text, structured }) {
  const [open, setOpen] = useState(false);

  let badge = null;
  const rows = sectionRowCount(structured);
  if (rows) {
    badge = `${rows} row${rows !== 1 ? 's' : ''}`;
  } else {
    const narrative = structured?.kind === 'narrative' ? structured.text : text;
    const words = narrative ? narrative.trim().split(/\s+/).filter(Boolean).length : 0;
    if (words > 5) badge = `${words} words`;
  }

  return (
    <div className={`section-item${open ? ' open' : ''}`}>
      <div className="section-item__header" onClick={() => setOpen((o) => !o)}>
        <span>{title}</span>
        {badge && <span className="section-data-badge">{badge}</span>}
        <span className="section-item__chevron"><Icon name="chevron-right" /></span>
      </div>
      <div className="section-item__body">{open && <SectionBody text={text} structured={structured} />}</div>
    </div>
  );
}

export function CaseCard({ c }) {
  const [open, setOpen] = useState(false);
  const count = c._sectionCount ?? sectionCount(c);

  return (
    <div className={`case-card${open ? ' open' : ''}`}>
      <div className="case-card__header" onClick={() => setOpen((o) => !o)}>
        <div>
          <div className="case-card__title">{`${c.case_type} ${c.case_no}/${c.case_year}`}</div>
          <div className="case-card__subtitle">{`${c.petitioner} v/s ${c.respondent}`}</div>
          <span className="case-card__badge">{`${count} section${count !== 1 ? 's' : ''} with data`}</span>
          {c.judgment_pdf && (
            <span className="case-card__badge" title={c.judgment_pdf}>
              <Icon name="file-text" /> Judgment PDF in download
            </span>
          )}
        </div>
        <div className="case-card__chevron"><Icon name="chevron-right" /></div>
      </div>
      <div className="case-card__body">
        {open && (
          <div className="section-accordion">
            {collectSections(c).map(([name, text, structured]) => (
              <SectionItem key={name} title={name} text={text} structured={structured} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
