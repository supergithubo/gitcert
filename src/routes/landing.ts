import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env } from '../env';
import { countAttestedRepos } from '../lib/db';
import { CACHE_CONTROL, CORS_ALLOW_ALL, edgeCache } from '../lib/cache';
import { SESSION_COOKIE_NAME, clearSessionCookie, verifySessionCookie } from '../lib/session';
import { LandingPage } from '../pages/landing';

/**
 * `GET /` (spec overview §Step 2, M4). Mounted LAST in `src/index.ts`'s
 * route assembly. The cookie check runs BEFORE any `caches.default` lookup:
 * only cookie-less requests ever consult or populate the shared cache, so a
 * personalized variant can never leak through it (architectures/edge-cache).
 * Any request carrying `gc_session` bypasses `caches.default` entirely —
 * `no-store`, owner-surface parity with `/dashboard`. No GitHub call
 * anywhere in this route; the unauth path does zero I/O beyond the cache
 * lookup (pure template render).
 */
export const landing = new Hono<{ Bindings: Env }>();

async function renderUnauthResponse(): Promise<Response> {
  const html = await LandingPage({ auth: null });
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': CACHE_CONTROL.landing,
      ...CORS_ALLOW_ALL,
    },
  });
}

landing.get('/', async (c) => {
  const cookieValue = getCookie(c, SESSION_COOKIE_NAME);

  if (!cookieValue) {
    return edgeCache(c.req.raw, c.executionCtx, renderUnauthResponse);
  }

  // Cookie present: NEVER touch caches.default from here on, valid or not.
  const session = await verifySessionCookie(cookieValue, c.env.SESSION_SECRET);

  if (!session) {
    // Invalid/expired session: render the same unauth markup (the page
    // still works), but `no-store` and clear the stale cookie so the
    // client falls back onto the cacheable cookie-less path next request.
    // Every header — including Set-Cookie — is set directly on this one
    // hand-built Response; nothing is buffered via `c.header()` first, so
    // there is nothing for Hono to drop (reviewer finding V-001).
    const html = await LandingPage({ auth: null });
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=UTF-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': clearSessionCookie(),
      },
    });
  }

  const attestedCount = await countAttestedRepos(c.env.DB, session.githubId);
  const html = await LandingPage({ auth: { attestedCount } });
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'no-store',
    },
  });
});
