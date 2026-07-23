import { Hono } from 'hono';
import type { Env } from '../env';
import { selectPublicRepoState } from '../lib/db';
import { CACHE_CONTROL, CORS_ALLOW_ALL, edgeCache } from '../lib/cache';
import { VerifyCollectingPage, VerifyNotFoundPage, VerifyPage } from '../pages/verify';

/**
 * `GET /verify/:owner/:repo` (spec overview §Route Contracts). A thin
 * controller: one `selectPublicRepoState` read → typed props into the pure
 * verify page components (pages never fetch or read D1/env themselves).
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

async function buildVerifyResponse(db: D1Database, owner: string, repo: string): Promise<Response> {
  const state = await selectPublicRepoState(db, owner, repo);

  if (state.visibility === 'hidden') {
    // One page and status for every hidden/unknown cause — no existence
    // oracle. Shares the `collecting` tier's short TTL (not the `verify`
    // tier's) so a toggle off→on's cache purge is backstopped by a fast
    // client-side re-check even if a purge is ever missed (production
    // defect: toggle-cache-purge).
    const html = await VerifyNotFoundPage({ owner, repo });
    return htmlResponse(html, 404, CACHE_CONTROL.collecting);
  }
  if (state.visibility === 'collecting') {
    const html = await VerifyCollectingPage({ owner, repo });
    return htmlResponse(html, 200, CACHE_CONTROL.collecting);
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
  });
  return htmlResponse(html, 200, CACHE_CONTROL.verify);
}

verify.get('/verify/:owner/:repo', async (c) => {
  const owner = c.req.param('owner');
  const repo = c.req.param('repo');
  return edgeCache(c.req.raw, c.executionCtx, () => buildVerifyResponse(c.env.DB, owner, repo));
});
