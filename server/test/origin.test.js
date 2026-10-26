import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isSameSite } from '../src/utils/origin.js';

describe('isSameSite', () => {
  it('accepts requests with no Origin, and Origin equal to Host', () => {
    assert.equal(isSameSite(undefined, { host: 'localhost:5173' }), true);
    assert.equal(isSameSite('http://localhost:5173', { host: 'localhost:5173' }), true);
  });

  it('refuses another site, another port, and a malformed Origin', () => {
    assert.equal(isSameSite('http://evil.example', { host: 'localhost:5173' }), false);
    assert.equal(isSameSite('http://localhost:9999', { host: 'localhost:5173' }), false);
    assert.equal(isSameSite('not a url', { host: 'localhost:5173' }), false);
  });

  it('honours X-Forwarded-Host only when the proxy is trusted', () => {
    const headers = { host: '127.0.0.1:8000', 'x-forwarded-host': 'iudicium.example.com, internal' };
    assert.equal(isSameSite('https://iudicium.example.com', headers, false), false);
    assert.equal(isSameSite('https://iudicium.example.com', headers, true), true);
    assert.equal(isSameSite('https://evil.example', headers, true), false);
  });
});
