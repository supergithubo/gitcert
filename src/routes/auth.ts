import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env } from '../env';
import { GITHUB_USER_AGENT } from '../collector/github';
import { kickPostInstallCollect, parseInstallationId } from '../lib/postInstall';
import {
  STATE_COOKIE_NAME,
  clearSessionCookie,
  clearStateCookie,
  createSessionCookie,
  createStateCookie,
  verifyState,
} from '../lib/session';
import { AuthErrorPage } from '../pages/auth';

/**
 * `GET /auth/login`, `GET /auth/callback`, `POST /auth/logout` (spec
 * overview §Route contracts). GitHub calls happen ONLY in `/auth/callback`
 * here (sanctioned by cloudflare-workers rules) — the exchanged user token
 * is used once for identity and discarded, never stored or logged
 * (architectures/attestation, CRITICAL). Owner routes: always `no-store`,
 * never `edgeCache`, no CORS.
 */
export const auth = new Hono<{ Bindings: Env }>();

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';

interface GithubTokenResponse {
  access_token?: string;
}

interface GithubUserResponse {
  id?: unknown;
  login?: unknown;
}

interface GithubIdentity {
  id: number;
  login: string;
}

/** Exchanges an OAuth `code` for a one-time user access token. Returns `null` (never throws) on any failure. */
async function exchangeCodeForToken(env: Env, code: string): Promise<string | null> {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': GITHUB_USER_AGENT,
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as GithubTokenResponse;
  return body.access_token ?? null;
}

/**
 * Fetches `{ id, login }` for the token's holder. The token is used for
 * this single request only — the caller discards it immediately after
 * (never stored, never logged).
 */
async function fetchGithubIdentity(accessToken: string): Promise<GithubIdentity | null> {
  const response = await fetch(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': GITHUB_USER_AGENT,
    },
  });
  if (!response.ok) return null;
  const body = (await response.json()) as GithubUserResponse;
  if (typeof body.id !== 'number' || typeof body.login !== 'string') return null;
  return { id: body.id, login: body.login };
}

/**
 * Every callback failure branch (spec overview): `400`, generic
 * `AuthErrorPage` copy (no internals leaked, SEC-007), state cookie
 * cleared, `no-store`.
 */
async function authErrorResponse(): Promise<Response> {
  const html = await AuthErrorPage();
  return new Response(html, {
    status: 400,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'no-store',
      'Set-Cookie': clearStateCookie(),
    },
  });
}

auth.get('/auth/login', (c) => {
  const { nonce, setCookieHeader } = createStateCookie();
  const authorizeUrl = new URL(GITHUB_AUTHORIZE_URL);
  authorizeUrl.searchParams.set('client_id', c.env.GITHUB_CLIENT_ID);
  authorizeUrl.searchParams.set('state', nonce);
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizeUrl.toString(),
      'Set-Cookie': setCookieHeader,
      'Cache-Control': 'no-store',
    },
  });
});

auth.get('/auth/callback', async (c) => {
  // (1) GitHub reports an authorize-time error.
  if (c.req.query('error')) {
    return authErrorResponse();
  }

  // (2) state must match the gc_oauth_state cookie, timing-safe — UNLESS
  // this is GitHub's install-initiated shape ("Request user authorization
  // during installation"): GitHub starts that dance itself, so the browser
  // never receives a gc_oauth_state cookie and GitHub never sends a state
  // param. Only an ABSENT state+cookie pair combined with install params
  // qualifies for the bypass; a PRESENT-but-wrong state must still fail
  // even when install params are present (no bypass on a failed check).
  //
  // Security note: this leaves the standard, accepted login-CSRF residual
  // for GitHub App install flows — an attacker who crafts this callback
  // can at worst sign the victim into the attacker's own identity. It
  // grants no access to the victim's data: the post-install collect kick
  // below is gated by `kickPostInstallCollect`'s D1 ownership check against
  // the identity actually exchanged for this request, not by anything the
  // attacker controls.
  const stateCookie = getCookie(c, STATE_COOKIE_NAME);
  const stateParam = c.req.query('state');
  const isInstallShapeWithoutState =
    !stateParam &&
    !stateCookie &&
    parseInstallationId(c.req.query('installation_id')) !== null &&
    !!c.req.query('setup_action');
  if (!isInstallShapeWithoutState && !verifyState(stateParam, stateCookie)) {
    return authErrorResponse();
  }

  // (3) exchange code for a one-time user token.
  const code = c.req.query('code');
  const accessToken = code ? await exchangeCodeForToken(c.env, code) : null;
  if (!accessToken) {
    return authErrorResponse();
  }

  // (4) identify the user. The token is discarded after this call —
  // never stored, never logged (architectures/attestation, CRITICAL).
  const identity = await fetchGithubIdentity(accessToken);
  if (!identity) {
    return authErrorResponse();
  }

  // (5) set the session cookie, clear the state cookie.
  const sessionSetCookie = await createSessionCookie(
    { githubId: identity.id, login: identity.login },
    c.env.SESSION_SECRET,
  );
  c.header('Set-Cookie', sessionSetCookie, { append: true });
  c.header('Set-Cookie', clearStateCookie(), { append: true });
  c.header('Cache-Control', 'no-store');

  // (6) Decision 9: both GitHub redirect shapes land here when
  // "Request user authorization on install" is enabled.
  const installationId = parseInstallationId(c.req.query('installation_id'));
  if (installationId !== null && c.req.query('setup_action')) {
    await kickPostInstallCollect(c.env, c.executionCtx, identity.id, installationId);
  }

  // (7)
  return c.redirect('/dashboard', 302);
});

auth.post('/auth/logout', (c) => {
  // Signed-out landing is now the only signed-out surface (spec overview
  // §Step 9 — `SignedOutPage` is retired). Redirect to `/?signed_out=1`, a
  // cache key DISTINCT from the base `/` (Decision B) so the ack band is
  // never a per-request mutation of the shared cached page. Every header —
  // including Location and Set-Cookie — is set directly on this one
  // hand-built Response; nothing is buffered via `c.header()` first, so
  // there is nothing for Hono to drop (reviewer finding V-001).
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/?signed_out=1',
      'Cache-Control': 'no-store',
      'Set-Cookie': clearSessionCookie(),
    },
  });
});
