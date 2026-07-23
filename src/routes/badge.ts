import { Hono } from 'hono';
import type { Env } from '../env';
import { selectPublicRepoState, type PublicReadyState } from '../lib/db';
import {
  CACHE_CONTROL,
  CORS_ALLOW_ALL,
  buildEtag,
  edgeCache,
  withConditionalGet,
} from '../lib/cache';
import { languageChipColor } from '../badges/theme';
import { renderBadge } from '../badges/render';
import { metricLabel, metricValue } from '../badges/value';
import type { BadgeStyle, BadgeTheme, Metric } from '../badges/types';

/**
 * `GET /b/:owner/:repo/:metric.svg` (spec overview §Route Contracts). A
 * thin controller: parse/validate params → one `selectPublicRepoState`
 * read → hand off to the pure badge templates. Never a broken image —
 * every branch below returns a 200 designed SVG.
 */
export const badge = new Hono<{ Bindings: Env }>();

const METRICS: ReadonlySet<string> = new Set<Metric>([
  'commits',
  'last-commit',
  'issues',
  'open-prs',
  'language',
  'created',
  'first-commit',
  'size',
]);

const LABEL_MAX_LENGTH = 64;
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const ATTESTED_BY = 'attested by gitcert';

function parseMetric(slug: string): Metric | null {
  return METRICS.has(slug) ? (slug as Metric) : null;
}

function parseStyle(value: string | undefined): BadgeStyle {
  return value === 'pill' ? 'pill' : 'flat';
}

function parseTheme(value: string | undefined): BadgeTheme {
  return value === 'dark' || value === 'auto' ? value : 'light';
}

/** Caps a label override at 64 chars (spec overview §Route Contracts); escaping is the template's job. */
function parseLabel(value: string | undefined): string | undefined {
  return value ? value.slice(0, LABEL_MAX_LENGTH) : undefined;
}

function isStale(collectedAt: string, nowIso: string): boolean {
  return new Date(nowIso).getTime() - new Date(collectedAt).getTime() > STALE_THRESHOLD_MS;
}

function svgResponse(svg: string, cacheControl: string, etag: string | null): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'image/svg+xml',
    'Cache-Control': cacheControl,
    ...CORS_ALLOW_ALL,
  };
  if (etag) headers.ETag = etag;
  return new Response(svg, { status: 200, headers });
}

interface BadgeRequestParams {
  owner: string;
  repo: string;
  style: BadgeStyle;
  theme: BadgeTheme;
  labelOverride?: string;
  nowIso: string;
}

/**
 * Unknown metric slug — the fail-soft "not found" badge (svg-badges /
 * edge-cache rules: never a broken image). Independent of repo state, so
 * no D1 read is needed; `metric: 'commits'` is an inert placeholder since
 * this state never renders metric-specific chrome.
 */
function unknownMetricBadge(params: BadgeRequestParams): Response {
  const svg = renderBadge({
    metric: 'commits',
    label: 'not found',
    state: { kind: 'not-found' },
    style: params.style,
    theme: params.theme,
    title: `${params.owner}/${params.repo}: not found (${ATTESTED_BY})`,
  });
  return svgResponse(svg, CACHE_CONTROL.normal, null);
}

/** Unknown / excluded / removed / suspended-installation repo — one indistinguishable "not found" badge (no existence oracle). */
function hiddenBadge(params: BadgeRequestParams, metric: Metric, label: string): Response {
  const svg = renderBadge({
    metric,
    label,
    state: { kind: 'not-found' },
    style: params.style,
    theme: params.theme,
    title: `${params.owner}/${params.repo}: not found ${label} (${ATTESTED_BY})`,
  });
  return svgResponse(svg, CACHE_CONTROL.normal, null);
}

/** Public, live repo with no stats row yet. */
function collectingBadge(params: BadgeRequestParams, metric: Metric, label: string): Response {
  const svg = renderBadge({
    metric,
    label,
    state: { kind: 'collecting' },
    style: params.style,
    theme: params.theme,
    title: `${params.owner}/${params.repo}: collecting… ${label} (${ATTESTED_BY})`,
  });
  return svgResponse(svg, CACHE_CONTROL.collecting, null);
}

/** Public, live repo with a stored snapshot — normal or stale (>24h) depending on `collected_at`. */
async function readyBadge(
  params: BadgeRequestParams,
  metric: Metric,
  label: string,
  repoState: PublicReadyState,
): Promise<Response> {
  const stale = isStale(repoState.collectedAt, params.nowIso);
  const value = metricValue(metric, repoState.stats, params.nowIso);
  const langChip =
    metric === 'language' ? languageChipColor(repoState.stats.primaryLanguage) : null;
  const svg = renderBadge({
    metric,
    label,
    state: { kind: stale ? 'stale' : 'normal', value, langChip },
    style: params.style,
    theme: params.theme,
    title: `${params.owner}/${params.repo}: ${value} ${label} (${ATTESTED_BY})`,
  });
  const etag = await buildEtag(
    [repoState.certSerial, metric, params.style, params.theme],
    params.labelOverride,
  );
  return svgResponse(svg, CACHE_CONTROL.normal, etag);
}

async function buildBadgeResponse(
  db: D1Database,
  metricSlug: string,
  params: BadgeRequestParams,
): Promise<Response> {
  const metric = parseMetric(metricSlug);
  if (!metric) return unknownMetricBadge(params);

  const label = params.labelOverride ?? metricLabel(metric);
  const repoState = await selectPublicRepoState(db, params.owner, params.repo);

  if (repoState.visibility === 'hidden') return hiddenBadge(params, metric, label);
  if (repoState.visibility === 'collecting') return collectingBadge(params, metric, label);
  return readyBadge(params, metric, label, repoState);
}

badge.get('/b/:owner/:repo/:metricSvg{.+\\.svg}', async (c) => {
  const params: BadgeRequestParams = {
    owner: c.req.param('owner'),
    repo: c.req.param('repo'),
    style: parseStyle(c.req.query('style')),
    theme: parseTheme(c.req.query('theme')),
    labelOverride: parseLabel(c.req.query('label')),
    nowIso: new Date().toISOString(),
  };
  const metricSlug = c.req.param('metricSvg').replace(/\.svg$/, '');

  const response = await edgeCache(c.req.raw, c.executionCtx, () =>
    buildBadgeResponse(c.env.DB, metricSlug, params),
  );
  return withConditionalGet(c.req.raw, response);
});
