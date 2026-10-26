import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import Icon from '../components/Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../utils/api.js';

const STATUS = {
  running: { label: 'Running', className: 'history-status--running' },
  done: { label: 'Completed', className: 'history-status--done' },
  cancelled: { label: 'Stopped', className: 'history-status--cancelled' },
  failed: { label: 'Failed', className: 'history-status--failed' },
};

const KIND = { detailed: 'Detailed Search', quick: 'Quick Search' };
const SOURCE = { form: 'Form', assistant: 'AI Assistant' };

function Avatar({ user }) {
  const [broken, setBroken] = useState(false);
  if (user.picture && !broken) {
    return <img className="account-avatar" src={user.picture} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  return <span className="account-avatar account-avatar--initial">{(user.name || user.email).trim().charAt(0).toUpperCase()}</span>;
}

export default function Account() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searches, setSearches] = useState(null); // null = loading
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setSearches((await api('/api/history')).searches);
      setError('');
    } catch (err) {
      setError(err.message);
      setSearches((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Open the matching search page with the same parameters; it fills the form in and runs the search. */
  const runAgain = (search) => navigate(search.kind === 'quick' ? '/quick-search' : '/search', { state: { rerun: search.params } });

  const remove = async (id) => {
    try {
      await api(`/api/history/${id}`, { method: 'DELETE' });
      setSearches((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  const clearAll = async () => {
    if (!window.confirm('Delete your whole search history? This cannot be undone.')) return;
    try {
      await api('/api/history', { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <main className="layout layout--landing">
      <section className="card account-card">
        <Avatar user={user} />
        <div>
          <h2 className="account-card__name">{user.name}</h2>
          <p className="account-card__email">{user.email}</p>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Previous searches</h2>
          {searches?.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearAll}>
              <Icon name="trash-2" /> Clear all
            </button>
          )}
        </div>

        {error && <p className="login-card__error" role="alert">{error}</p>}
        {searches === null && <p className="hint">Loading&hellip;</p>}
        {searches?.length === 0 && !error && (
          <p className="hint">No searches yet. Searches you run from the forms or the AI Assistant will be listed here, ready to run again.</p>
        )}

        <ul className="history-list">
          {(searches ?? []).map((s) => {
            const status = STATUS[s.status] ?? STATUS.failed;
            return (
              <li key={s.id} className="history-item">
                <div className="history-item__main">
                  <div className="history-item__top">
                    <span className="case-card__badge">{KIND[s.kind]}</span>
                    <span className="history-item__source">via {SOURCE[s.source] ?? s.source}</span>
                    <span className={`history-status ${status.className}`} title={s.error || undefined}>{status.label}</span>
                  </div>
                  <div className="history-item__title">{s.title}</div>
                  <div className="history-item__meta">
                    {new Date(s.created_at).toLocaleString()}
                    {s.case_count != null && ` · ${s.case_count} case${s.case_count === 1 ? '' : 's'}`}
                    {s.status === 'failed' && s.error && ` · ${s.error.slice(0, 120)}`}
                  </div>
                </div>
                <div className="history-item__actions">
                  <button type="button" className="btn btn-primary btn-sm" disabled={s.status === 'running'} onClick={() => runAgain(s)}>
                    <Icon name="rotate-ccw" /> Run again
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" aria-label={`Delete: ${s.title}`} disabled={s.status === 'running'} onClick={() => remove(s.id)}>
                    <Icon name="trash-2" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
