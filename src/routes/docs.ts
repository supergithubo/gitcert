import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env } from '../env';
import { CACHE_CONTROL, CORS_ALLOW_ALL, edgeCache } from '../lib/cache';
import { SESSION_COOKIE_NAME, clearSessionCookie, verifySessionCookie } from '../lib/session';
import { DocsPage } from '../pages/docs';

/**
 * `GET /docs` (spec overview §Step 7). Mirrors `routes/landing.ts`'s
 * cookie-first pattern verbatim: the cookie check runs BEFORE any
 * `caches.default` lookup, so only cookie-less requests ever consult or
 * populate the shared cache — a personalized (signed-in) variant can never
 * leak through it (architectures/edge-cache). Any request carrying
 * `gc_session` bypasses `caches.default` entirely, valid or not —
 * `no-store`. No GitHub call, no D1 read anywhere in this route; the docs
 * body itself is identical either way, only the account prop (and thus the
 * shared Nav) differs. Mounted in `src/index.ts` before `landing` (the
 * catch-all `GET /`), alongside the other specific routes.
 */
export const docs = new Hono<{ Bindings: Env }>();

async function renderUnauthResponse(): Promise<Response> {
  const html = await DocsPage({ account: null });
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': CACHE_CONTROL.docs,
      ...CORS_ALLOW_ALL,
    },
  });
}

docs.get('/docs', async (c) => {
  const cookieValue = getCookie(c, SESSION_COOKIE_NAME);

  if (!cookieValue) {
    return edgeCache(c.req.raw, c.executionCtx, renderUnauthResponse);
  }

  // Cookie present: NEVER touch caches.default from here on, valid or not.
  const session = await verifySessionCookie(cookieValue, c.env.SESSION_SECRET);

  if (!session) {
    // Invalid/expired session: render the same signed-out markup (the page
    // still works), but `no-store` and clear the stale cookie so the client
    // falls back onto the cacheable cookie-less path next request. Every
    // header — including Set-Cookie — is set directly on this one
    // hand-built Response; nothing is buffered via `c.header()` first, so
    // there is nothing for Hono to drop (reviewer finding V-001).
    const html = await DocsPage({ account: null });
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=UTF-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': clearSessionCookie(),
      },
    });
  }

  const html = await DocsPage({ account: { handle: session.login } });
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'no-store',
    },
  });
});
