import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env } from '../env';
import { runCollector } from '../collector/run';
import { purgePublicUrls } from '../lib/cache';
import { selectOwnedRepo, selectOwnedRepos, updateRepoIncluded } from '../lib/db';
import { kickPostInstallCollect, parseInstallationId } from '../lib/postInstall';
import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  type SessionPayload,
  verifySessionCookie,
} from '../lib/session';
import { DashboardPage } from '../pages/dashboard';

/**
 * `GET /dashboard`, `GET /setup`, `POST /repos/:id/settings`,
 * `POST /repos/:id/refresh` (spec overview §Route contracts). Owner
 * routes: always `Cache-Control: no-store`, never `edgeCache`, no CORS.
 * Every mutation is tenant-scoped through the session → `installations`
 * join (architectures/multi-tenant) — unknown/not-owned/removed resources
 * are a uniform `404`, never `403` (Decision 4, CRITICAL: a `403` would be
 * an existence oracle for private repos).
 */
export const dashboard = new Hono<{ Bindings: Env }>();

/** Mirrors `lib/postInstall.ts`'s `FRESHNESS_WINDOW_MS` — same "don't re-collect something just collected" rule, applied here as a 429 instead of a skip. */
const REFRESH_RATE_LIMIT_MS = 5 * 60 * 1000;

async function getSession(c: Context<{ Bindings: Env }>): Promise<SessionPayload | null> {
  const cookieValue = getCookie(c, SESSION_COOKIE_NAME);
  return verifySessionCookie(cookieValue, c.env.SESSION_SECRET);
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function htmlResponse(html: string, status: number): Response {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-store' },
  });
}

function redirectNoStore(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: location, 'Cache-Control': 'no-store' },
  });
}

function parseRepoId(raw: string): number | null {
  const value = Number(raw);
  return Number.isInteger(value) ? value : null;
}

type IncludedBody = { kind: 'ok'; included: boolean } | { kind: 'malformed' } | { kind: 'invalid' };

/** Body must be exactly `{ "included": boolean }` (spec overview §Route contracts) — malformed JSON vs. wrong shape are distinguished so the route can 400 vs. 422. */
async function parseIncludedBody(request: Request): Promise<IncludedBody> {
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return { kind: 'malformed' };
  }
  if (typeof body !== 'object' || body === null) return { kind: 'invalid' };
  const keys = Object.keys(body as Record<string, unknown>);
  const included = (body as Record<string, unknown>).included;
  if (keys.length !== 1 || keys[0] !== 'included' || typeof included !== 'boolean') {
    return { kind: 'invalid' };
  }
  return { kind: 'ok', included };
}

dashboard.get('/dashboard', async (c) => {
  const session = await getSession(c);
  if (!session) {
    // Route through a context method (`c.redirect`), not a raw `new
    // Response(...)` — Hono only flushes `c.header()`-buffered headers
    // (here, the clear-cookie) onto responses returned via its own
    // context methods; a hand-built `Response` bypasses that buffer
    // entirely and silently drops them (reviewer finding V-001).
    c.header('Set-Cookie', clearSessionCookie());
    c.header('Cache-Control', 'no-store');
    return c.redirect('/auth/login', 302);
  }

  const { accounts, lastSyncAt } = await selectOwnedRepos(c.env.DB, session.githubId);
  const html = await DashboardPage({ login: session.login, accounts, lastSyncAt });
  return htmlResponse(html, 200);
});

dashboard.get('/setup', async (c) => {
  const session = await getSession(c);
  if (!session) {
    return redirectNoStore('/auth/login');
  }

  // Decision 9: never errors user-visibly — an unowned/unknown/suspended
  // installation_id is a silent no-op inside kickPostInstallCollect.
  const installationId = parseInstallationId(c.req.query('installation_id'));
  if (installationId !== null) {
    await kickPostInstallCollect(c.env, c.executionCtx, session.githubId, installationId);
  }
  return redirectNoStore('/dashboard');
});

dashboard.post('/repos/:id/settings', async (c) => {
  const session = await getSession(c);
  if (!session) return jsonResponse({ error: 'unauthorized' }, 401);

  const repoId = parseRepoId(c.req.param('id'));
  if (repoId === null) return jsonResponse({ error: 'not_found' }, 404);

  const parsed = await parseIncludedBody(c.req.raw);
  if (parsed.kind === 'malformed') return jsonResponse({ error: 'malformed_json' }, 400);
  if (parsed.kind === 'invalid') return jsonResponse({ error: 'invalid_body' }, 422);

  const changes = await updateRepoIncluded(c.env.DB, repoId, parsed.included, session.githubId);
  if (changes === 0) return jsonResponse({ error: 'not_found' }, 404);

  const repo = await selectOwnedRepo(c.env.DB, repoId, session.githubId);
  if (repo) {
    c.executionCtx.waitUntil(purgePublicUrls({ owner: repo.owner, name: repo.name }));
  }

  return jsonResponse({ ok: true, included: parsed.included }, 200);
});

dashboard.post('/repos/:id/refresh', async (c) => {
  const session = await getSession(c);
  if (!session) return jsonResponse({ error: 'unauthorized' }, 401);

  const repoId = parseRepoId(c.req.param('id'));
  if (repoId === null) return jsonResponse({ error: 'not_found' }, 404);

  const repo = await selectOwnedRepo(c.env.DB, repoId, session.githubId);
  if (!repo) return jsonResponse({ error: 'not_found' }, 404);

  if (
    repo.collectedAt !== null &&
    Date.now() - new Date(repo.collectedAt).getTime() < REFRESH_RATE_LIMIT_MS
  ) {
    return jsonResponse({ error: 'rate_limited' }, 429);
  }

  // Per-repo refresh: collect only this repo, not the whole installation —
  // the row's sync icon acts on the repo the user clicked (the cron still
  // batches the full installation).
  c.executionCtx.waitUntil(
    runCollector(c.env, { installationId: repo.installationId, repoId: repo.id }).then(() =>
      purgePublicUrls({ owner: repo.owner, name: repo.name }),
    ),
  );

  return jsonResponse({ ok: true }, 202);
});
