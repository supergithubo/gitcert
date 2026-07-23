import { Hono } from 'hono';
import type { Env } from '../env';
import { selectOldestCollectedAt, selectPublicRepoState } from '../lib/db';
import { derivePublicKey } from '../lib/sign';
import {
  CACHE_CONTROL,
  CORS_ALLOW_ALL,
  buildEtag,
  edgeCache,
  withConditionalGet,
} from '../lib/cache';

/**
 * `GET /api/:owner/:repo.json`, `GET /pubkey`, `GET /healthz`
 * (spec overview §Route Contracts; SPEC.md §5, §10 layout). Thin
 * controllers only — signing/derivation/query logic lives in `lib/`.
 */
export const api = new Hono<{ Bindings: Env }>();

/** Fixed per SPEC.md §7 — the same constant `payload.ts` uses for `issuer`. */
const PUBLIC_KEY_URL = 'https://gitcert.harborstack.app/pubkey';

function jsonResponse(body: unknown, status: number, cacheControl: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': cacheControl,
      ...CORS_ALLOW_ALL,
    },
  });
}

/**
 * Builds the 200 envelope by string concatenation around the stored
 * `payload_json` bytes — NEVER `JSON.parse`/re-serialize them, or the
 * stored signature stops verifying (architectures/attestation, CRITICAL).
 */
function verbatimPayloadResponse(payloadJson: string, signature: string, etag: string): Response {
  const body = `{"payload":${payloadJson},"signature":${JSON.stringify(signature)},"public_key_url":${JSON.stringify(PUBLIC_KEY_URL)}}`;
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': CACHE_CONTROL.normal,
      ETag: etag,
      ...CORS_ALLOW_ALL,
    },
  });
}

async function buildApiResponse(db: D1Database, owner: string, repo: string): Promise<Response> {
  const state = await selectPublicRepoState(db, owner, repo);

  if (state.visibility === 'hidden') {
    // Byte-identical for unknown/excluded/removed/suspended — no
    // existence oracle. Shares the `collecting` tier's short TTL (not
    // `normal`'s) so a toggle off→on's cache purge is backstopped by a
    // fast client-side re-check even if a purge is ever missed
    // (production defect: toggle-cache-purge).
    return jsonResponse({ error: 'not_found' }, 404, CACHE_CONTROL.collecting);
  }
  if (state.visibility === 'collecting') {
    return jsonResponse({ error: 'collecting' }, 404, CACHE_CONTROL.collecting);
  }
  const etag = await buildEtag([state.certSerial]);
  return verbatimPayloadResponse(state.payloadJson, state.signature, etag);
}

api.get('/api/:owner/:repoJson{.+\\.json}', async (c) => {
  const owner = c.req.param('owner');
  const repo = c.req.param('repoJson').replace(/\.json$/, '');

  const response = await edgeCache(c.req.raw, c.executionCtx, () =>
    buildApiResponse(c.env.DB, owner, repo),
  );
  return withConditionalGet(c.req.raw, response);
});

api.get('/pubkey', async (c) => {
  return edgeCache(c.req.raw, c.executionCtx, async () => {
    const { raw, jwk } = await derivePublicKey(c.env.SIGNING_KEY);
    const body = {
      algorithm: 'Ed25519',
      public_key: raw,
      jwk: { kty: 'OKP', crv: 'Ed25519', x: jwk.x },
    };
    return jsonResponse(body, 200, CACHE_CONTROL.pubkey);
  });
});

api.get('/healthz', async (c) => {
  const oldestCollectedAt = await selectOldestCollectedAt(c.env.DB);
  const maxLagSeconds =
    oldestCollectedAt === null
      ? null
      : Math.floor((Date.now() - new Date(oldestCollectedAt).getTime()) / 1000);
  // Deliberately bypasses `edgeCache`/`caches.default` — an operational
  // probe whose entire value is freshness (architectures/edge-cache).
  return jsonResponse({ status: 'ok', max_lag_seconds: maxLagSeconds }, 200, CACHE_CONTROL.noStore);
});
