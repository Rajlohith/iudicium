import { useEffect, useRef } from 'react';

import Icon from './Icon.jsx';

/** <option>s for a dropdown: a blank placeholder followed by { value, label } entries. */
export function Options({ placeholder, items = [] }) {
  return (
    <>
      <option value="">{placeholder}</option>
      {items.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </>
  );
}

/** "Sections to Include" checklist. `selected` is a Set of section names. */
export function SectionsChecklist({ names = [], selected, onChange }) {
  const toggle = (name) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange(next);
  };

  return (
    <div className="field-group">
      <label className="field-label">
        Sections to Include <span className="opt">(everything the case page has, unless you narrow it down)</span>
      </label>
      <div className="row-actions" style={{ margin: '0 0 8px' }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(new Set(names))}>
          Select all
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(new Set())}>
          Select none
        </button>
      </div>
      <div className="checkbox-list" style={{ maxHeight: 220 }}>
        {names.map((name) => (
          <label key={name} className="checkbox-row">
            <input type="checkbox" checked={selected.has(name)} onChange={() => toggle(name)} />
            <span>{name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** null when every section is ticked (no filter), otherwise the chosen names. */
export const includedSections = (names, selected) => (selected.size === names.length ? null : [...selected]);

export function ProgressBar({ progress }) {
  if (!progress) return null;
  return (
    <div className="progress-wrap">
      <div className="progress-bar">
        <div className="progress-bar__fill" style={{ width: `${progress.pct}%` }} />
      </div>
      <p className="progress-label">{progress.label}</p>
    </div>
  );
}

export function ActivityLog({ logs, onClear }) {
  const box = useRef(null);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [logs]);

  return (
    <section className="card log-card">
      <div className="log-card__title">
        <h2>Activity Log</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
          <Icon name="trash-2" /> Clear
        </button>
      </div>
      <div className="log-box" ref={box}>
        {logs.map((entry, i) => (
          <div key={i} className={`log-line${entry.isErr ? ' err' : ''}`}>{`[${entry.ts}] ${entry.text}`}</div>
        ))}
      </div>
    </section>
  );
}
