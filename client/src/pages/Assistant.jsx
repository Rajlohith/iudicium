import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import Icon from '../components/Icon.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import { api } from '../utils/api.js';
import { caseLabel, caseParties, summaryPrompt, trimCase } from '../utils/caseHandoff.js';
import { summarize } from '../utils/results.js';
import { KEYS, readJson, remove, writeJson } from '../utils/storage.js';

// Cap what gets sent to the server on every turn so the payload (and the
// resulting LLM prompt) stays a reasonable size, and drop what the
// assistant doesn't need (raw table rows, structured duplicates, ...).
const MAX_CASES_SENT = 60;

const RESULT_PAGES = { detailed: '/search', quick: '/quick-search' };

const trimCases = (cases) => (cases || []).slice(0, MAX_CASES_SENT).map(trimCase);

let nextId = 1;
const newId = () => nextId++;

// ----------------------------------------------------------------------
// Tiny, safe markdown: headings, **bold**, *italic*, `code`, bullet and
// numbered lists (with nesting), paragraphs.
// Everything is rendered as React elements (never as raw HTML).
// ----------------------------------------------------------------------

function Inline({ text }) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

const HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;
const LIST_ITEM = /^(\s*)([*\-•]|\d+[.)])\s+(.+)$/;

/** Turns consecutive list lines into nested <ul>/<ol>, using indentation for depth. */
function renderList(items, keyPrefix) {
  let pos = 0;
  const build = (depth, key) => {
    const ordered = items[pos].ordered;
    const base = items[pos].indent;
    const children = [];
    while (pos < items.length && items[pos].indent >= base) {
      const item = items[pos];
      if (item.indent > base) {
        // deeper than this list: belongs to the previous <li>
        const nested = build(depth + 1, `${key}-${pos}`);
        const last = children.pop();
        children.push(
          <li key={last.key}>
            {last.props.children}
            {nested}
          </li>,
        );
        continue;
      }
      children.push(<li key={`${key}-${pos}`}><Inline text={item.text} /></li>);
      pos += 1;
    }
    const Tag = ordered ? 'ol' : 'ul';
    return <Tag key={key}>{children}</Tag>;
  };
  const out = [];
  while (pos < items.length) out.push(build(0, `${keyPrefix}-l${pos}`));
  return out;
}

function Markdown({ text }) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = [];

  const flushPara = () => {
    if (!para.length) return;
    const k = `p${out.length}`;
    out.push(
      <p key={k}>
        {para.map((line, i) => (
          <Fragment key={i}>
            {i > 0 && <br />}
            <Inline text={line} />
          </Fragment>
        ))}
      </p>,
    );
    para = [];
  };
  const flushList = () => {
    if (!list.length) return;
    out.push(...renderList(list, `k${out.length}`));
    list = [];
  };

  lines.forEach((raw) => {
    const heading = raw.match(HEADING);
    const item = raw.match(LIST_ITEM);
    if (!raw.trim()) {
      flushPara();
      flushList();
    } else if (heading) {
      flushPara();
      flushList();
      out.push(<h4 key={`h${out.length}`} className="md-heading"><Inline text={heading[1]} /></h4>);
    } else if (item) {
      flushPara();
      list.push({ indent: item[1].replace(/\t/g, '    ').length, ordered: /\d/.test(item[2]), text: item[3] });
    } else {
      flushList();
      para.push(raw.trim());
    }
  });
  flushPara();
  flushList();
  return out;
}

// ----------------------------------------------------------------------
// Cards that appear in the conversation
// ----------------------------------------------------------------------

function ParamCard({ item, onRun, onEdit, onStartOver, runDisabled }) {
  const { data, stale } = item;
  const hasRows = data.display?.length > 0;
  return (
    <div className={`chat-msg chat-msg--bot chat-msg--block`}>
      <div className={`param-card${data.ready ? ' param-card--ready' : ''}${stale ? ' param-card--stale' : ''}`}>
        <div className="param-card__head">
          <span><Icon name="list-checks" /> Search parameters</span>
          {data.ready && <span className="param-card__mode">{data.mode === 'quick' ? 'Quick Search' : 'Detailed Search'}</span>}
        </div>
        {hasRows ? (
          <table className="param-card__table">
            <tbody>
              {data.display.map((r) => (
                <tr key={r.key}><th>{r.key}</th><td>{r.value}</td></tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="param-card__empty">Nothing understood yet.</p>
        )}
        {data.missing?.length > 0 && (
          <div className="param-card__missing">
            <strong>Still needed</strong>
            <ul>{data.missing.map((m) => <li key={m}>{m}</li>)}</ul>
          </div>
        )}
        {data.warnings?.length > 0 && (
          <div className="param-card__warn">
            <ul>{data.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
        )}
        <div className="param-card__actions">
          {data.ready && (
            <button type="button" className="btn btn-primary btn-sm" disabled={runDisabled || stale} onClick={onRun}>
              <Icon name="play" /> Run search
            </button>
          )}
          {hasRows && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit(data.mode)}>
                <Icon name="pencil" /> Edit in form
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onStartOver}>
                <Icon name="x" /> Start over
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function RunCard({ item, onStop }) {
  const { mode, pct, status, lines, finished, headText } = item;
  const label = mode === 'quick' ? 'Quick Search' : 'Detailed Search';
  return (
    <div className="chat-msg chat-msg--bot chat-msg--block">
      <div className="run-card">
        <div className="run-card__head">
          <span>
            <Icon name={finished ? 'check' : 'loader'} /> {finished ? headText : `Running ${label}…`}
          </span>
          {!finished && (
            <button type="button" className="btn btn-danger btn-sm" disabled={item.stopping} onClick={onStop}>
              <Icon name="square" /> Stop
            </button>
          )}
        </div>
        <div className="run-card__bar"><div className="run-card__fill" style={{ width: `${pct}%` }} /></div>
        <div className="run-card__status">{status}</div>
        <pre className="run-card__log">
          {lines.map((l, i) => <div key={i} className={l.isErr ? 'err' : undefined}>{l.text}</div>)}
        </pre>
      </div>
    </div>
  );
}

function OverviewCard({ item }) {
  const { cases, summary, mode, downloadHref } = item;
  return (
    <div className="chat-msg chat-msg--bot chat-msg--block">
      <div className="overview-card">
        <div className="overview-card__head"><Icon name="file-check" /> Results overview</div>
        <p>{summary}</p>
        {cases.length > 0 && (
          <ul className="overview-card__list">
            {cases.slice(0, 5).map((c, i) => {
              const id = [c.case_type, c.case_no, c.case_year].filter(Boolean).join(' / ');
              const parties = [c.petitioner, c.respondent].filter(Boolean).join(' vs ');
              return (
                <li key={i}>
                  <strong>{id}</strong>{parties ? ` — ${parties}` : ''}
                </li>
              );
            })}
            {cases.length > 5 && <li className="muted">…and {cases.length - 5} more</li>}
          </ul>
        )}
        <div className="overview-card__actions">
          {cases.length > 0 && (
            <Link className="btn btn-primary btn-sm" to={RESULT_PAGES[mode]}>
              <Icon name="external-link" /> Open in cases view
            </Link>
          )}
          <a className="btn btn-outline btn-sm" href={downloadHref} download>
            <Icon name="download" /> Download Excel
          </a>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
// Page
// ----------------------------------------------------------------------

export default function Assistant() {
  const navigate = useNavigate();
  const location = useLocation();
  const { subscribe } = useSocket();

  // `history` is what the model sees; `items` is what the person sees (it also holds the cards).
  const [items, setItems] = useState([]);
  const [history, setHistory] = useState([]);
  const [fields, setFields] = useState({});
  const [caseContext, setCaseContext] = useState(null); // { mode: 'detailed' | 'quick' | 'case', summary, cases }
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [activeRun, setActiveRun] = useState(null); // { id, mode } while a search started from here is running

  const messagesRef = useRef(null);
  const inputRef = useRef(null);
  const restored = useRef(false);

  // Always-current copies for callbacks that outlive a render (WebSocket handler).
  const activeRunRef = useRef(null);
  activeRunRef.current = activeRun;

  const addItem = useCallback((item) => setItems((prev) => [...prev, { id: newId(), ...item }]), []);
  const addBot = useCallback((text) => addItem({ kind: 'bot', text }), [addItem]);
  const patchItem = useCallback(
    (id, patch) => setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...(typeof patch === 'function' ? patch(it) : patch) } : it))),
    [],
  );

  // -- session persistence ------------------------------------------------

  const saveSession = useCallback((next) => writeJson(KEYS.assistantSession, next), []);

  // Set below, once `sendMessage` exists; the restore effect runs after render so it is always current.
  const sendMessageRef = useRef(null);

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;

    const handoff = location.state?.summariseCase;
    if (handoff) {
      // Arrived from a "Summarise" button on a case card: start a fresh conversation about
      // that one case and ask for the summary straight away. Clear the router state first so a
      // refresh or "back" doesn't start it again.
      navigate(location.pathname, { replace: true, state: null });
      const context = { mode: 'case', summary: caseLabel(handoff), cases: [handoff] };
      setFields({});
      setHistory([]);
      setItems([]);
      setCaseContext(context);
      saveSession({ history: [], fields: {}, caseContext: context });
      sendMessageRef.current(summaryPrompt(handoff), { history: [], fields: {}, caseContext: context });
    } else {
      const data = readJson(KEYS.assistantSession);
      if (data) {
        setFields(data.fields || {});
        setCaseContext(data.caseContext || null);
        const past = data.history || [];
        setHistory(past);
        setItems(past.map((m) => ({ id: newId(), kind: m.role === 'user' ? 'user' : 'bot', text: m.content })));
      }
    }
    api('/api/search/status')
      .then((s) => s.is_running && addBot('Note: a search is currently running from another page. Wait for it to finish before starting a new one.'))
      .catch(() => {});
  }, [addBot, location, navigate, saveSession]);

  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  // -- live search progress ---------------------------------------------------

  useEffect(
    () =>
      subscribe((message) => {
        const run = activeRunRef.current;
        if (!run) return;
        const { type, payload } = message;
        const appendLine = (text, isErr = false) =>
          patchItem(run.id, (it) => ({ lines: [...it.lines, { text, isErr }] }));

        if (type === 'log') {
          appendLine(payload);
        } else if (type === 'progress') {
          patchItem(run.id, {
            pct: payload.total ? Math.round((payload.done / payload.total) * 100) : 0,
            status: `Processed ${payload.done} of ${payload.total} search job(s)…`,
          });
        } else if (type === 'case_progress') {
          patchItem(run.id, { status: `Opening case ${payload.done} of ${payload.total}${payload.label ? ` — ${payload.label}` : ''}` });
        } else if (type === 'error') {
          appendLine(`Error: ${payload}`, true);
          patchItem(run.id, { finished: true, pct: 100, status: 'Search failed.', headText: 'Search failed.' });
          setActiveRun(null);
          addBot(`The search failed: ${payload}`);
        } else if (type === 'done') {
          const cases = payload.cases || [];
          const summary = summarize(run.mode, payload);
          const text = payload.cancelled ? `Stopped — ${summary}` : `Done — ${summary}`;
          patchItem(run.id, { finished: true, pct: 100, status: text, headText: text });
          setActiveRun(null);

          // Keep a trimmed copy so the assistant can answer questions about these results from now on.
          const context = cases.length ? { mode: run.mode, summary, cases: trimCases(cases) } : null;
          setCaseContext(context);

          addItem({
            kind: 'overview',
            cases,
            summary,
            mode: run.mode,
            downloadHref: `/outputs/${encodeURIComponent(payload.output_filename)}`,
          });

          const followUp = cases.length
            ? 'Search complete. Ask me anything about these cases, or say “summarize these” for an overview — you can also open the cases view for filters and full details, or tell me how to refine the search.'
            : 'Nothing matched. Try widening the date range, checking the spelling of names, or a different bench.';
          addBot(followUp);
          setHistory((prev) => {
            const next = [...prev, { role: 'assistant', content: followUp }];
            saveSession({ history: next, fields: readJson(KEYS.assistantSession)?.fields ?? {}, caseContext: context });
            return next;
          });
        }
      }),
    [subscribe, patchItem, addItem, addBot, saveSession],
  );

  // -- actions ----------------------------------------------------------------

  // `ctx` lets a caller that has just changed state (the Summarise hand-off) override
  // what this render's closure still holds.
  const sendMessage = async (text, ctx = {}) => {
    const baseHistory = ctx.history ?? history;
    const baseFields = ctx.fields ?? fields;
    const baseContext = ctx.caseContext !== undefined ? ctx.caseContext : caseContext;

    const nextHistory = [...baseHistory, { role: 'user', content: text }];
    setHistory(nextHistory);
    addItem({ kind: 'user', text });
    setSending(true);

    try {
      const data = await api('/api/assistant', {
        method: 'POST',
        body: { messages: nextHistory, fields: baseFields, cases: baseContext ? baseContext.cases : [] },
      });

      const reply = data.reply || "Sorry, I didn't get a response.";
      const withReply = [...nextHistory, { role: 'assistant', content: reply }];
      setHistory(withReply);
      addBot(reply);

      let nextFields = baseFields;
      if (!data.error) {
        nextFields = data.fields || {};
        setFields(nextFields);
        if (data.display?.length || (data.missing?.length && withReply.length > 2)) {
          setItems((prev) => [
            ...prev.map((it) => (it.kind === 'params' ? { ...it, stale: true } : it)),
            { id: newId(), kind: 'params', data, stale: false },
          ]);
        }
      }
      saveSession({ history: withReply, fields: nextFields, caseContext: baseContext });
    } catch (err) {
      console.error(err);
      addBot("Sorry, I couldn't reach the assistant right now.");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };
  sendMessageRef.current = sendMessage;

  const runSearch = async () => {
    if (activeRun) {
      addBot('A search is already running. Stop it first or wait for it to finish.');
      return;
    }
    let data;
    try {
      data = await api('/api/assistant/run', { method: 'POST', body: { fields } });
    } catch (err) {
      addBot(`Couldn't start the search: ${err.message}`);
      return;
    }
    if (!data.started) {
      addBot(data.message || "Couldn't start the search.");
      return;
    }

    const mode = data.mode || 'detailed';
    const id = newId();
    setItems((prev) => [
      ...prev,
      { id, kind: 'run', mode, pct: 0, status: 'Starting browser…', lines: [], finished: false, stopping: false, headText: '' },
    ]);
    setActiveRun({ id, mode });
  };

  const stopSearch = async () => {
    if (activeRun) patchItem(activeRun.id, { stopping: true });
    try {
      await api('/api/search/stop', { method: 'POST' });
    } catch {
      /* the server will report what happened */
    }
  };

  const editInForm = (mode) => {
    writeJson(KEYS.assistantPrefill, fields);
    navigate(mode === 'quick' ? '/quick-search' : '/search');
  };

  const startOver = () => {
    setFields({});
    setHistory([]);
    remove(KEYS.assistantSession);
    setItems((prev) => [...prev.map((it) => (it.kind === 'params' ? { ...it, stale: true } : it)), { id: newId(), kind: 'bot', text: 'Cleared. What would you like to search for?' }]);
  };

  const stopCaseContext = () => {
    setCaseContext(null);
    saveSession({ history, fields, caseContext: null });
  };

  const clearChat = () => {
    const message = activeRun
      ? 'A search is currently running. Clear the chat anyway? (The running search keeps going in the background — this only clears the conversation view.)'
      : 'Clear this chat and start a new conversation?';
    if (!window.confirm(message)) return;
    setFields({});
    setHistory([]);
    setItems([]);
    setCaseContext(null);
    remove(KEYS.assistantSession);
  };

  const submit = (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    sendMessage(text);
  };

  const onInput = (e) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.form.requestSubmit();
    }
  };

  const renderItem = (item) => {
    switch (item.kind) {
      case 'user':
        return (
          <div key={item.id} className="chat-msg chat-msg--user">
            <div className="chat-msg__bubble">{item.text}</div>
          </div>
        );
      case 'bot':
        return (
          <div key={item.id} className="chat-msg chat-msg--bot">
            <div className="chat-msg__bubble"><Markdown text={item.text} /></div>
          </div>
        );
      case 'params':
        return (
          <ParamCard key={item.id} item={item} runDisabled={Boolean(activeRun)} onRun={runSearch} onEdit={editInForm} onStartOver={startOver} />
        );
      case 'run':
        return <RunCard key={item.id} item={item} onStop={stopSearch} />;
      case 'overview':
        return <OverviewCard key={item.id} item={item} />;
      default:
        return null;
    }
  };

  return (
    <div className="assistant-wrap">
      <div className="chat-window">
        {caseContext?.mode === 'case' && caseContext.cases[0] && (
          <div className="case-context-bar">
            <span className="case-context-bar__text">
              <Icon name="file-text" /> Chatting about <strong>{caseLabel(caseContext.cases[0])}</strong>
              {caseParties(caseContext.cases[0]) ? ` — ${caseParties(caseContext.cases[0])}` : ''}
            </span>
            <button type="button" className="link-btn" onClick={stopCaseContext}>Stop using this case</button>
          </div>
        )}
        <div className="chat-messages" ref={messagesRef}>
          <div className="chat-msg chat-msg--bot">
            <div className="chat-msg__bubble">
              Describe the case search you want in plain English, for example:{' '}
              <em>"Writ petitions against State of Karnataka at the Principal Bench between January and March 2024"</em> or{' '}
              <em>"WP 12345 of 2023, Dharwad bench"</em>.
            </div>
          </div>
          {items.map(renderItem)}
          {sending && (
            <div className="chat-msg chat-msg--bot chat-msg--typing">
              <div className="chat-msg__bubble">Thinking…</div>
            </div>
          )}
        </div>
        <form className="chat-input-row" onSubmit={submit}>
          <textarea ref={inputRef} rows={1} placeholder="Type a message…" value={input} onChange={onInput} onKeyDown={onKeyDown} />
          <button
            type="button"
            className="btn btn-ghost chat-clear-btn"
            title="Clear chat and start a new conversation"
            aria-label="Clear chat"
            onClick={clearChat}
          >
            <Icon name="trash-2" />
          </button>
          <button type="submit" className="btn btn-primary chat-send-btn" aria-label="Send" disabled={sending}>
            <Icon name="send" />
          </button>
        </form>
      </div>
    </div>
  );
}
