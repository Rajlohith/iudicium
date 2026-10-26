import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../utils/api.js';
import { buildResults, saveResults } from '../utils/results.js';

const SocketContext = createContext({ connected: false, subscribe: () => () => {} });

// A finished job normally arrives over the WebSocket within milliseconds. If it
// hasn't turned up after this long, the status endpoint gets to deliver it.
const POLL_GRACE_MS = 2000;

/**
 * Live updates for the whole app.
 *
 *  - One WebSocket carries log lines, progress and the final outcome, and
 *    reconnects automatically.
 *  - A slow poll of /api/search/status is the safety net: if the final
 *    outcome of a search (results or error) never arrived over the socket,
 *    it is fetched over plain HTTP and delivered to the pages exactly as if
 *    it had. So a flaky WebSocket can delay the live log but can never leave
 *    a page stuck on "Starting…".
 *
 * Finished results are saved here too, so a search that completes while the
 * person is on a different page is still waiting for them afterwards.
 */
export function SocketProvider({ children, pollMs = 2500 }) {
  const [connected, setConnected] = useState(false);
  const listeners = useRef(new Set());
  const delivered = useRef(new Set()); // job ids whose outcome the pages have already seen

  const deliver = useCallback((message) => {
    if (message.type === 'done' && message.payload?.kind) {
      saveResults(message.payload.kind, buildResults(message.payload.kind, message.payload));
    }
    if ((message.type === 'done' || message.type === 'error') && message.job != null) {
      delivered.current.add(message.job);
    }
    listeners.current.forEach((listener) => listener(message));
  }, []);

  // -- WebSocket ---------------------------------------------------------------
  useEffect(() => {
    let socket;
    let timer;
    let closed = false;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const current = new WebSocket(`${protocol}://${window.location.host}/ws/logs`);
      socket = current;

      // Every handler checks `closed`: React StrictMode mounts, unmounts and re-mounts
      // this effect in development, and the discarded socket must not touch state.
      current.onopen = () => !closed && setConnected(true);
      current.onclose = () => {
        if (closed) return;
        setConnected(false);
        timer = setTimeout(connect, 2000);
      };
      current.onerror = () => current.close();
      current.onmessage = (event) => {
        if (closed) return;
        try {
          deliver(JSON.parse(event.data));
        } catch {
          /* ignore a malformed frame */
        }
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, [deliver]);

  // -- HTTP safety net -----------------------------------------------------------
  useEffect(() => {
    let active = true;
    let baselined = false;

    const tick = async () => {
      try {
        const status = await api('/api/search/status');
        if (!active) return;
        const last = status.last_job;

        if (!baselined) {
          // Whatever finished before this page loaded is old news.
          baselined = true;
          if (!status.mine && last) delivered.current.add(last.id);
          return;
        }
        if (status.mine || !last || delivered.current.has(last.id)) return;
        if (last.ended_ago_ms < POLL_GRACE_MS) return; // give the WebSocket first go

        delivered.current.add(last.id);
        if (last.state === 'done') {
          const result = await api('/api/search/result');
          if (active) deliver({ type: 'done', payload: result, job: last.id });
        } else {
          deliver({ type: 'error', payload: last.message, job: last.id });
        }
      } catch {
        /* server briefly unreachable -- try again next tick */
      }
    };

    tick();
    const interval = setInterval(tick, pollMs);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [deliver, pollMs]);

  const subscribe = useCallback((listener) => {
    listeners.current.add(listener);
    return () => listeners.current.delete(listener);
  }, []);

  const value = useMemo(() => ({ connected, subscribe }), [connected, subscribe]);
  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export const useSocket = () => useContext(SocketContext);
