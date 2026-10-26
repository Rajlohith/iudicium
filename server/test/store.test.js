import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createStore } from '../src/services/store.js';

const person = (store, n = 1) => store.upsertUser({ sub: `s${n}`, email: `p${n}@x.com`, name: `P${n}`, picture: null });
const add = (store, userId, extra = {}) => store.addSearch({ userId, kind: 'quick', source: 'form', title: 't', params: { a: 1 }, ...extra });

describe('store', () => {
  it('expires sessions and purges them', async () => {
    const store = createStore();
    const u = person(store);
    const token = store.createSession(u.id, 30);
    assert.equal(store.getSessionUser(token).id, u.id);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(store.getSessionUser(token), null);
    assert.equal(store.purgeExpiredSessions(), 1);
  });

  it('matches an existing account by email when the Google id is new, and keeps one row', () => {
    const store = createStore();
    const a = store.upsertUser({ sub: null, email: 'X@Y.com', name: 'X', picture: null });
    const b = store.upsertUser({ sub: 'g1', email: 'x@y.com', name: 'X Y', picture: 'p' });
    assert.equal(a.id, b.id);
    assert.deepEqual([b.google_sub, b.name], ['g1', 'X Y']);
  });

  it('keeps only the newest 500 searches per person', () => {
    const store = createStore();
    const u = person(store);
    const other = person(store, 2);
    add(store, other.id);
    for (let i = 0; i < 503; i += 1) add(store, u.id, { title: `s${i}` });
    const list = store.listSearches(u.id, 1000);
    assert.equal(list.length, 500);
    assert.equal(list[0].title, 's502');
    assert.equal(store.listSearches(other.id).length, 1);
  });

  it('only lets a search be finished or deleted by its owner', () => {
    const store = createStore();
    const a = person(store);
    const b = person(store, 2);
    const id = add(store, a.id);
    store.finishSearch(id, b.id, { status: 'done', caseCount: 9 });
    assert.equal(store.getSearch(a.id, id).status, 'running');
    assert.equal(store.deleteSearch(b.id, id), false);
    store.finishSearch(id, a.id, { status: 'failed', error: 'boom' });
    assert.deepEqual([store.getSearch(a.id, id).status, store.getSearch(a.id, id).error], ['failed', 'boom']);
  });

  it('marks searches that were running when the server stopped as interrupted', () => {
    const store = createStore();
    const u = person(store);
    const id = add(store, u.id);
    assert.equal(store.failStaleSearches(), 1);
    assert.match(store.getSearch(u.id, id).error, /Interrupted/);
  });

  it('deleting an account removes its sessions and searches', () => {
    const store = createStore();
    const u = person(store);
    store.createSession(u.id, 10_000);
    add(store, u.id);
    store.db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 0);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM searches').get().n, 0);
  });
});
