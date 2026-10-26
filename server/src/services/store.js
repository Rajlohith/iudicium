/**
 * The database: accounts, login sessions, and each person's search history.
 *
 * SQLite through better-sqlite3 -- one file, no server to install or run, and
 * synchronous, which keeps the code short. Everything the rest of the app
 * needs goes through this module, so swapping in another database later
 * (MongoDB, Postgres) means re-implementing these functions and nothing else.
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

const MAX_SEARCHES_PER_USER = 500;

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export function createStore(file = ':memory:') {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      google_sub    TEXT UNIQUE,
      email         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      picture       TEXT,
      created_at    TEXT NOT NULL,
      last_login_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS searches (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL CHECK (kind IN ('detailed', 'quick')),
      source      TEXT NOT NULL CHECK (source IN ('form', 'assistant')),
      title       TEXT NOT NULL,
      params      TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'cancelled', 'failed')),
      case_count  INTEGER,
      error       TEXT,
      created_at  TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_searches_user ON searches (user_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
  `);

  const q = {
    userBySub: db.prepare('SELECT * FROM users WHERE google_sub = ?'),
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    insertUser: db.prepare(
      'INSERT INTO users (google_sub, email, name, picture, created_at, last_login_at) VALUES (@sub, @email, @name, @picture, @now, @now)',
    ),
    updateUser: db.prepare(
      'UPDATE users SET google_sub = @sub, email = @email, name = @name, picture = @picture, last_login_at = @now WHERE id = @id',
    ),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    sessionUser: db.prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
    ),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    insertSearch: db.prepare(
      `INSERT INTO searches (user_id, kind, source, title, params, status, created_at)
       VALUES (@userId, @kind, @source, @title, @params, 'running', @now)`,
    ),
    finishSearch: db.prepare(
      `UPDATE searches SET status = @status, case_count = @caseCount, error = @error, finished_at = @now
       WHERE id = @id AND user_id = @userId`,
    ),
    listSearches: db.prepare('SELECT * FROM searches WHERE user_id = ? ORDER BY id DESC LIMIT ?'),
    getSearch: db.prepare('SELECT * FROM searches WHERE id = ? AND user_id = ?'),
    deleteSearch: db.prepare('DELETE FROM searches WHERE id = ? AND user_id = ?'),
    clearSearches: db.prepare("DELETE FROM searches WHERE user_id = ? AND status != 'running'"),
    pruneSearches: db.prepare(
      `DELETE FROM searches WHERE user_id = @userId AND id NOT IN
         (SELECT id FROM searches WHERE user_id = @userId ORDER BY id DESC LIMIT @keep)`,
    ),
    failStale: db.prepare(
      `UPDATE searches SET status = 'failed', error = 'Interrupted: the server restarted before this search finished.', finished_at = ?
       WHERE status = 'running'`,
    ),
  };

  const iso = () => new Date().toISOString();
  const searchRow = (row) => row && { ...row, params: JSON.parse(row.params) };

  return {
    db,

    // -- accounts -----------------------------------------------------------

    /** Create the account on first sign-in; afterwards refresh the name/picture from Google. */
    upsertUser({ sub, email, name, picture }) {
      const now = iso();
      const clean = { sub: sub ?? null, email: email.toLowerCase(), name: name || email, picture: picture ?? null, now };
      const existing = (sub && q.userBySub.get(sub)) || q.userByEmail.get(clean.email);
      if (existing) {
        q.updateUser.run({ ...clean, id: existing.id });
        return q.userById.get(existing.id);
      }
      const { lastInsertRowid } = q.insertUser.run(clean);
      return q.userById.get(lastInsertRowid);
    },

    getUser: (id) => q.userById.get(id) ?? null,

    // -- login sessions -----------------------------------------------------
    // Only a SHA-256 of the session token is stored, so a copy of the database can't be used to log in.

    createSession(userId, ttlMs) {
      const token = randomBytes(32).toString('base64url');
      const now = Date.now();
      q.insertSession.run(sha256(token), userId, now, now + ttlMs);
      return token;
    },

    getSessionUser: (token) => (token ? q.sessionUser.get(sha256(token), Date.now()) ?? null : null),

    deleteSession(token) {
      if (token) q.deleteSession.run(sha256(token));
    },

    purgeExpiredSessions: () => q.purgeSessions.run(Date.now()).changes,

    // -- search history -----------------------------------------------------

    addSearch({ userId, kind, source, title, params }) {
      const { lastInsertRowid } = q.insertSearch.run({ userId, kind, source, title, params: JSON.stringify(params), now: iso() });
      q.pruneSearches.run({ userId, keep: MAX_SEARCHES_PER_USER });
      return Number(lastInsertRowid);
    },

    finishSearch(id, userId, { status, caseCount = null, error = null }) {
      if (id == null) return;
      q.finishSearch.run({ id, userId, status, caseCount, error, now: iso() });
    },

    listSearches: (userId, limit = 200) => q.listSearches.all(userId, limit).map(searchRow),
    getSearch: (userId, id) => searchRow(q.getSearch.get(id, userId)) ?? null,
    deleteSearch: (userId, id) => q.deleteSearch.run(id, userId).changes > 0,
    clearSearches: (userId) => q.clearSearches.run(userId).changes,

    /** After a restart, searches still marked "running" can never finish; mark them failed. */
    failStaleSearches: () => q.failStale.run(iso()).changes,

    close: () => db.close(),
  };
}
