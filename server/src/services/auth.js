/**
 * Sign-in with Google, restricted to an allow-list, with cookie sessions.
 *
 * Flow:
 *   1. The browser shows Google's "Sign in with Google" button and receives a
 *      signed ID token (a JWT) from Google.
 *   2. It POSTs that token to /api/auth/google. We verify the signature and the
 *      audience with Google's public keys, require a verified email, and check
 *      the email against ALLOWED_EMAILS (server/src/allowedEmails.js).
 *   3. If allowed, the account is created/updated (name and picture come from
 *      Google) and a random session token is set as an HttpOnly cookie. Only a
 *      hash of the token is stored in the database.
 *
 * The allow-list is re-checked on every request, so removing an address locks
 * that person out immediately, even if they are signed in.
 */

import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';

export const SESSION_COOKIE = 'iudicium_session';

/** Verify a Google ID token for this app's client ID; resolves with its payload or throws. */
export function createGoogleVerifier(clientId) {
  const client = new OAuth2Client(clientId);
  return async (credential) => {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
    return ticket.getPayload();
  };
}

export function parseCookies(header = '') {
  const cookies = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      cookies[name] = part.slice(i + 1).trim();
    }
  }
  return cookies;
}

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, picture: u.picture });

const credentialSchema = z.object({ credential: z.string().min(20).max(8000) });

/**
 * store:         the database (services/store.js)
 * verify:        async (credential) => Google ID-token payload; null when Google sign-in isn't configured
 * allowedEmails: the allow-list
 * clientId:      the Google OAuth client ID, handed to the browser
 */
export function createAuth({ store, verify, allowedEmails, clientId = '', sessionDays = 7 }) {
  const allowed = new Set(allowedEmails.map((e) => String(e).trim().toLowerCase()).filter(Boolean));
  const isAllowed = (email) => allowed.has(String(email ?? '').trim().toLowerCase());
  const ttlMs = sessionDays * 24 * 60 * 60 * 1000;

  const tokenOf = (req) => parseCookies(req.headers.cookie)[SESSION_COOKIE];

  /** The signed-in, still-authorised person behind this request, or null. */
  function userFromRequest(req) {
    const user = store.getSessionUser(tokenOf(req));
    return user && isAllowed(user.email) ? user : null;
  }

  function setSessionCookie(req, res, token, maxAgeMs) {
    const parts = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
    if (req.secure) parts.push('Secure');
    res.append('Set-Cookie', parts.join('; '));
  }

  const authenticate = (req, _res, next) => {
    req.user = userFromRequest(req);
    next();
  };

  const requireAuth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Please sign in.', code: 'unauthenticated' }));

  const router = Router();

  // What the login page needs to render Google's button.
  router.get('/config', (_req, res) => res.json({ client_id: clientId || null }));

  router.get('/me', (req, res) => {
    const user = userFromRequest(req);
    res.json({ user: user ? publicUser(user) : null });
  });

  router.post('/google', async (req, res) => {
    if (!verify) {
      return res.status(503).json({ error: 'Google sign-in is not configured: set GOOGLE_CLIENT_ID in .env.', code: 'not_configured' });
    }
    const parsed = credentialSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Missing Google credential.' });

    let payload;
    try {
      payload = await verify(parsed.data.credential);
    } catch (err) {
      console.warn(`[auth] Google token rejected: ${err?.message ?? err}`);
      return res.status(401).json({ error: 'Google could not verify that sign-in. Please try again.', code: 'invalid_token' });
    }

    const email = String(payload?.email ?? '').toLowerCase();
    if (!email || payload.email_verified !== true) {
      return res.status(401).json({ error: 'That Google account has no verified email address.', code: 'unverified_email' });
    }
    if (!isAllowed(email)) {
      console.warn(`[auth] sign-in refused (not on the allow-list): ${email}`);
      return res.status(403).json({
        error: `${email} is not authorised to use this site. Ask the site owner to add it to server/src/allowedEmails.js.`,
        code: 'not_allowed',
        email,
      });
    }

    const user = store.upsertUser({ sub: payload.sub, email, name: payload.name || payload.given_name || email, picture: payload.picture });

    store.deleteSession(tokenOf(req)); // never reuse a previous session id after a fresh login
    setSessionCookie(req, res, store.createSession(user.id, ttlMs), ttlMs);
    res.json({ user: publicUser(user) });
  });

  router.post('/logout', (req, res) => {
    store.deleteSession(tokenOf(req));
    setSessionCookie(req, res, '', 0);
    res.json({ ok: true });
  });

  return { router, authenticate, requireAuth, userFromRequest, isAllowed };
}
