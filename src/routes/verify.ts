import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env } from '../env';
import { selectPublicRepoState } from '../lib/db';
import { CACHE_CONTROL, CORS_ALLOW_ALL, edgeCache } from '../lib/cache';
import { SESSION_COOKIE_NAME, clearSessionCookie, verifySessionCookie } from '../lib/session';
import { VerifyCollectingPage, VerifyNotFoundPage, VerifyPage } from '../pages/verify';

/**
 * `GET /verify/:owner/:repo` (spec overview §Route Contracts, spec overview
 * §Step 6). A thin controller: one `selectPublicRepoState` read → typed
 * props into the pure verify page components (pages never fetch or read
 * D1/env themselves). Mirrors `routes/docs.ts`/`routes/landing.ts`'s
 * cookie-first pattern verbatim: the cookie check runs BEFORE any
 * `caches.default` lookup, so only cookie-less requests ever consult or
 * populate the shared cache. No GitHub call, no ownership/owner-scoped D1
 * join anywhere in this route — session *presence* gates the generic
 * `← Back to dashboard` link, not ownership, and the link is identical
 * regardless of repo/owner/hidden-cause (no existence oracle).
 */
export const verify = new Hono<{ Bindings: Env }>();

function htmlResponse(html: string, status: number, cacheControl: string): Response {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': cacheControl,
      ...CORS_ALLOW_ALL,
    },
  });
}

/**
 * Resolves the visibility-driven page + status + per-state `Cache-Control`
 * tier — the one place that reads `selectPublicRepoState` and picks a page
 * component. `backLink` only ever toggles the generic `/dashboard` link
 * inside `CertFrame` (all three states, identical link) — it never changes
 * which branch runs, so the signed-in not-found page stays byte-identical
 * across every hidden cause (no existence oracle).
 */
async function resolveVerifyState(
  db: D1Database,
  params: { owner: string; repo: string; backLink: boolean },
): Promise<{ status: number; html: string; cacheControl: string }> {
  const { owner, repo, backLink } = params;
  const state = await selectPublicRepoState(db, owner, repo);

  if (state.visibility === 'hidden') {
    // One page and status for every hidden/unknown cause — no existence
    // oracle. Shares the `collecting` tier's short TTL (not the `verify`
    // tier's) so a toggle off→on's cache purge is backstopped by a fast
    // client-side re-check even if a purge is ever missed (production
    // defect: toggle-cache-purge).
    const html = await VerifyNotFoundPage({ owner, repo, backLink });
    return { status: 404, html, cacheControl: CACHE_CONTROL.collecting };
  }
  if (state.visibility === 'collecting') {
    const html = await VerifyCollectingPage({ owner, repo, backLink });
    return { status: 200, html, cacheControl: CACHE_CONTROL.collecting };
  }

  // No stale variant on the certificate (spec overview): the honest attested
  // timestamp already covers staleness, so `ready` always renders normally.
  const html = await VerifyPage({
    owner,
    repo,
    isPrivate: state.repo.private,
    certSerial: state.certSerial,
    collectedAt: state.collectedAt,
    signature: state.signature,
    stats: state.stats,
    backLink,
  });
  return { status: 200, html, cacheControl: CACHE_CONTROL.verify };
}

/**
 * Cookie-less path — UNCHANGED from the pre-session-aware route: same
 * `selectPublicRepoState` read, same page selection, same per-state
 * `Cache-Control` tier, same CORS header, `backLink` omitted so the bytes
 * are byte-identical to today. This is the only path `edgeCache` ever
 * wraps, so the shared cache never sees a personalized variant.
 */
async function buildVerifyResponse(db: D1Database, owner: string, repo: string): Promise<Response> {
  const { status, html, cacheControl } = await resolveVerifyState(db, {
    owner,
    repo,
    backLink: false,
  });
  return htmlResponse(html, status, cacheControl);
}

/** Valid session: same page, `backLink: true`, `no-store` (never cached, no CORS — page surface, not badge/API). */
async function buildSignedInResponse(
  db: D1Database,
  owner: string,
  repo: string,
): Promise<Response> {
  const { status, html } = await resolveVerifyState(db, { owner, repo, backLink: true });
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Invalid/expired session: render the same public markup (`backLink`
 * omitted — the page still works), but `no-store` and clear the stale
 * cookie so the client falls back onto the cacheable cookie-less path next
 * request. Every header — including Set-Cookie — is set directly on this
 * one hand-built Response; nothing is buffered via `c.header()` first, so
 * there is nothing for Hono to drop (reviewer finding V-001).
 */
async function buildInvalidSessionResponse(
  db: D1Database,
  owner: string,
  repo: string,
): Promise<Response> {
  const { status, html } = await resolveVerifyState(db, { owner, repo, backLink: false });
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'no-store',
      'Set-Cookie': clearSessionCookie(),
    },
  });
}

verify.get('/verify/:owner/:repo', async (c) => {
  const owner = c.req.param('owner');
  const repo = c.req.param('repo');
  const cookieValue = getCookie(c, SESSION_COOKIE_NAME);

  if (!cookieValue) {
    return edgeCache(c.req.raw, c.executionCtx, () => buildVerifyResponse(c.env.DB, owner, repo));
  }

  // Cookie present: NEVER touch caches.default from here on, valid or not.
  const session = await verifySessionCookie(cookieValue, c.env.SESSION_SECRET);

  if (!session) {
    return buildInvalidSessionResponse(c.env.DB, owner, repo);
  }

  return buildSignedInResponse(c.env.DB, owner, repo);
});
