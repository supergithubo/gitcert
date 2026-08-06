/**
 * Cache-Control policy constants and `caches.default` mechanics shared by
 * every public GET route (badge/api/verify/pubkey) — architectures/edge-cache.
 * `/healthz` deliberately never imports `edgeCache` (SPEC.md §5, `no-store`).
 */

import type { BadgeStyle, BadgeTheme, Metric } from '../badges/types';

/** CORS header every public GET sends, including on error responses (SPEC.md §5). */
export const CORS_ALLOW_ALL: Record<string, string> = { 'Access-Control-Allow-Origin': '*' };

/** Named `Cache-Control` values for the M2 public surfaces (SPEC.md §9, spec overview §Route Contracts). */
export const CACHE_CONTROL = {
  /** Badge/API 200 responses (normal + stale). */
  normal: 'public, max-age=300, s-maxage=1800, stale-while-revalidate=86400',
  /** Badge/API/verify `collecting…` responses — short TTL so first-install state clears fast. */
  collecting: 'public, max-age=60',
  /** The verify certificate (normal + not-found) — simpler policy than badge/API, no CDN/SWR tiers. */
  verify: 'public, max-age=300',
  /** `GET /`'s signed-out variant — same value as `verify` today, kept as its own name so per-surface tuning stays possible (M4 spec overview §Step 2). */
  landing: 'public, max-age=300',
  /** `GET /docs` — static reference page, same TTL as `landing`, named separately for per-surface tuning (spec overview §Step 7). */
  docs: 'public, max-age=300',
  /** `/pubkey`. */
  pubkey: 'public, max-age=86400',
  /**
   * `GET /version` (spec overview §Step 3). Deliberate deviation from the
   * layered TTLs above and from `/pubkey`'s 86400: `/version` exists to be
   * compared against `git rev-parse HEAD` immediately after a deploy, so a
   * long TTL would have auditors comparing a stale answer and concluding
   * drift that isn't there. Same converge-fast rationale as `collecting`
   * above (same value, separate name — do not "correct" this toward 86400).
   */
  version: 'public, max-age=60',
  /** `/healthz` only — bypasses `caches.default` entirely (operational probe, freshness is the point). */
  noStore: 'no-store',
} as const;

/**
 * Builds a strong ETag value (SPEC.md §5, spec overview's label-hash
 * clarification): `"cert_serial:metric:style:theme"`, with
 * `:sha256(label)[:8]` appended when a label override is present so the
 * ETag varies whenever rendered content varies. Callers only invoke this
 * when a `cert_serial` exists — `collecting…`/`not found` carry no ETag.
 */
export async function buildEtag(parts: readonly string[], label?: string): Promise<string> {
  let value = parts.join(':');
  if (label) {
    value += `:${await sha256Hex(label)}`;
  }
  return `"${value}"`;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
  return hex.slice(0, 8);
}

/** True when `ifNoneMatch` (a raw `If-None-Match` header value) matches `etag` exactly, or is `*`. */
export function matchesEtag(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const trimmed = ifNoneMatch.trim();
  if (trimmed === '*') return true;
  return trimmed
    .split(',')
    .map((candidate) => candidate.trim())
    .includes(etag);
}

/**
 * Downgrades `response` to a bodyless 304 when the request's
 * `If-None-Match` matches the response's own `ETag` header. Only
 * `ETag`/`Cache-Control`/CORS headers are carried onto the 304 — a 304
 * must not carry representation headers like `Content-Type`/`Content-Length`.
 * Responses with no `ETag` (collecting/not-found/pubkey) pass through
 * unchanged, since they are never conditionally requested.
 */
export function withConditionalGet(request: Request, response: Response): Response {
  const etag = response.headers.get('ETag');
  if (!etag || !matchesEtag(request.headers.get('If-None-Match'), etag)) {
    return response;
  }
  const headers = new Headers();
  headers.set('ETag', etag);
  const cacheControl = response.headers.get('Cache-Control');
  if (cacheControl) headers.set('Cache-Control', cacheControl);
  const cors = response.headers.get('Access-Control-Allow-Origin');
  if (cors) headers.set('Access-Control-Allow-Origin', cors);
  return new Response(null, { status: 304, headers });
}

/** The subset of `ExecutionContext` this module needs — narrower than Hono's or the ambient Workers type, so either satisfies it. */
export interface WaitUntilContext {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * Wraps a route handler with `caches.default`, keyed on the full request
 * URL (owner/repo/metric/style/theme/label all live in the URL, so no
 * variant bleeds — architectures/edge-cache). On a hit, the cached
 * response is returned without calling `handler` (no D1 read). On a miss,
 * `handler` runs, and the response is stored via `ctx.waitUntil` before
 * being returned — skipped when the response's `Cache-Control` is
 * `no-store` or missing, so error/edge responses that opt out stay
 * uncached.
 */
export async function edgeCache(
  request: Request,
  ctx: WaitUntilContext,
  handler: () => Promise<Response>,
): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request(request.url, request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const response = await handler();
  const cacheControl = response.headers.get('Cache-Control');
  if (cacheControl && !cacheControl.includes('no-store')) {
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }
  return response;
}

/** Canonical production origin — matches `wrangler.toml`'s route pattern and `routes/api.ts`'s `PUBLIC_KEY_URL`. */
const CANONICAL_ORIGIN = 'https://gitcert.harborstack.app';

const ALL_METRICS: readonly Metric[] = [
  'commits',
  'last-commit',
  'issues',
  'open-prs',
  'language',
  'created',
  'first-commit',
  'size',
];
const ALL_STYLES: readonly BadgeStyle[] = ['flat', 'pill'];
const ALL_THEMES: readonly BadgeTheme[] = ['light', 'dark', 'auto'];

/** Identity gitcert needs to purge a repo's badge cache entries. */
export interface RepoRef {
  owner: string;
  name: string;
}

function buildBadgeUrlVariants(repoRef: RepoRef): string[] {
  const base = `${CANONICAL_ORIGIN}/b/${repoRef.owner}/${repoRef.name}`;
  const urls: string[] = [];
  for (const metric of ALL_METRICS) {
    // Bare-default URL (no query string) — a distinct cache key from the
    // explicit-default-params URL below, since `edgeCache` keys on the
    // full request URL.
    urls.push(`${base}/${metric}.svg`);
    for (const style of ALL_STYLES) {
      for (const theme of ALL_THEMES) {
        urls.push(`${base}/${metric}.svg?style=${style}&theme=${theme}`);
      }
    }
  }
  return urls;
}

/**
 * The non-badge public surfaces that also render a repo's state
 * (`/verify/:owner/:repo`, `/api/:owner/:repo.json`) — each is a single
 * cache key (no style/theme/label variants), unlike badges.
 */
function buildVerifyAndApiUrls(repoRef: RepoRef): string[] {
  return [
    `${CANONICAL_ORIGIN}/verify/${repoRef.owner}/${repoRef.name}`,
    `${CANONICAL_ORIGIN}/api/${repoRef.owner}/${repoRef.name}.json`,
  ];
}

/**
 * Best-effort purge of every cached public URL for a repo — badge
 * variants (spec overview Decision 11: 8 metrics × {flat,pill} ×
 * {light,dark,auto} explicit-param URLs, plus one bare-default URL per
 * metric), plus the single `/verify/:owner/:repo` and
 * `/api/:owner/:repo.json` cache entries. Called (via `waitUntil`) after
 * a refresh collect completes and after a settings toggle (both
 * directions) — a toggle off→on must not leave a stale cached
 * `not found`/`collecting` verify or API response outliving the toggle
 * (production defect: toggle-cache-purge). A per-URL delete failure is
 * swallowed — a purge miss just means that one variant converges on its
 * own via TTL, and a purge must never fail the calling owner-route
 * mutation. Label-override/cache-buster badge variants are intentionally
 * not enumerated here — they converge by TTL (spec overview §Badge cache
 * purge).
 */
export async function purgePublicUrls(repoRef: RepoRef): Promise<void> {
  const cache = caches.default;
  const urls = [...buildBadgeUrlVariants(repoRef), ...buildVerifyAndApiUrls(repoRef)];
  await Promise.all(
    urls.map(async (url) => {
      try {
        await cache.delete(url);
      } catch {
        // best-effort — see doc comment above.
      }
    }),
  );
}
