import { useCallback, useEffect, useRef, useState } from 'react';

import { useSocket } from '../context/SocketContext.jsx';
import { api } from '../utils/api.js';
import { buildResults, clearResults, doneLabel, loadResults } from '../utils/results.js';

const timestamp = () => new Date().toLocaleTimeString();

/**
 * Everything a search page needs about one kind of job ('detailed' | 'quick'):
 * start/stop, live progress, the activity log (which survives reloads, the
 * server keeps a buffer), and the finished results (kept in sessionStorage).
 */
export function useSearchJob(kind) {
  const logPage = kind === 'quick' ? 'case_number' : 'search';
  const endpoint = kind === 'quick' ? '/api/case-number-search' : '/api/search';
  const { subscribe } = useSocket();

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null); // { pct, label } | null (hidden)
  const [logs, setLogs] = useState([]);
  const [results, setResults] = useState(() => {
    const stored = loadResults(kind);
    return stored ? { ...stored, summary: `${stored.summary ?? ''} (restored from this session)`.trim() } : null;
  });

  // Messages only matter to this page while one of its jobs is running.
  const runningRef = useRef(false);
  runningRef.current = running;

  const addLog = useCallback((text, isErr = false, ts = timestamp()) => {
    setLogs((prev) => [...prev, { text, isErr, ts }]);
  }, []);

  // Restore the server-side log buffer and whether a job is already running.
  useEffect(() => {
    let active = true;
    api(`/api/logs/${logPage}`)
      .then((data) => active && Array.isArray(data.entries) && setLogs(data.entries))
      .catch(() => {});
    api('/api/search/status')
      .then((data) => {
        if (active && data.mine && data.kind === kind) {
          setRunning(true);
          setProgress({ pct: 0, label: 'Fetching cases…' });
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [kind, logPage]);

  useEffect(
    () =>
      subscribe((message) => {
        const { type, payload } = message;
        if (type === 'done') {
          if (payload.kind !== kind) return;
          setRunning(false);
          setProgress({ pct: 100, label: doneLabel(kind, payload) });
          addLog(`Output saved to outputs/${payload.output_filename}`);
          setResults(buildResults(kind, payload));
          return;
        }
        if (!runningRef.current) return;
        if (type === 'log') {
          addLog(payload);
        } else if (type === 'progress') {
          setProgress({
            pct: payload.total ? Math.round((payload.done / payload.total) * 100) : 0,
            label: `Processed ${payload.done} of ${payload.total} search job(s)…`,
          });
        } else if (type === 'case_progress') {
          setProgress({
            pct: payload.total ? Math.round((payload.done / payload.total) * 100) : 0,
            label: `Extracting case ${payload.done} of ${payload.total}${payload.label ? ` for '${payload.label}'` : ''}…`,
          });
        } else if (type === 'error') {
          addLog(`ERROR: ${payload}`, true);
          setRunning(false);
        }
      }),
    [subscribe, kind, addLog],
  );

  const start = useCallback(
    async (criteria) => {
      setResults(null);
      setProgress({ pct: 0, label: 'Starting…' });
      setRunning(true);
      try {
        const data = await api(endpoint, { method: 'POST', body: criteria });
        if (!data.started) {
          addLog(data.message, true);
          setRunning(false);
        }
      } catch (err) {
        addLog(err.message, true);
        setRunning(false);
      }
    },
    [endpoint, addLog],
  );

  const stop = useCallback(async () => {
    setProgress((p) => ({ pct: p?.pct ?? 0, label: 'Stopping after the current step…' }));
    try {
      await api('/api/search/stop', { method: 'POST' });
    } catch {
      /* the next message from the server will tell the story */
    }
  }, []);

  const clearLog = useCallback(async () => {
    setLogs([]);
    try {
      await api(`/api/logs/${logPage}`, { method: 'DELETE' });
    } catch {
      /* ignore */
    }
  }, [logPage]);

  const dismissResults = useCallback(() => {
    setResults(null);
    clearResults(kind);
  }, [kind]);

  return { running, progress, logs, results, start, stop, clearLog, dismissResults };
}
