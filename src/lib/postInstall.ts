import type { Env } from '../env';
import { runCollector } from '../collector/run';
import type { WaitUntilContext } from './cache';
import { selectOwnedInstallationFreshness } from './db';

/**
 * Mirrors the 5-minute freshness window `routes/dashboard.ts`'s
 * `POST /repos/:id/refresh` rate limit uses (spec overview Route
 * contracts) — same business rule, "don't re-collect something just
 * collected", applied here to skip a redundant kick instead of a 429.
 */
const FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

/**
 * Shared Decision 9 post-install flow (spec overview): D1-verifies
 * `installationId` is owned by `accountId` and live, then — only if its
 * repos' stats are missing or older than 5 minutes — kicks a targeted
 * collector run via `waitUntil`. Used identically by `GET /auth/callback`'s
 * post-install branch and `GET /setup` so both GitHub redirect shapes
 * converge on one code path (both routes call this; neither duplicates the
 * logic). `installationId` is NEVER trusted for anything beyond this
 * D1-verified ownership lookup (multi-tenant Context Source rule); an
 * unowned/unknown/suspended id — including the race where a webhook's
 * insert hasn't landed yet — is a silent no-op, never a user-visible error.
 */
export async function kickPostInstallCollect(
  env: Env,
  executionCtx: WaitUntilContext,
  accountId: number,
  installationId: number,
): Promise<void> {
  const freshness = await selectOwnedInstallationFreshness(env.DB, installationId, accountId);
  if (!freshness) return;

  const isStale =
    freshness.latestCollectedAt === null ||
    Date.now() - new Date(freshness.latestCollectedAt).getTime() > FRESHNESS_WINDOW_MS;
  if (isStale) {
    executionCtx.waitUntil(runCollector(env, { installationId }));
  }
}

/**
 * Parses the `installation_id` query param as a positive integer, or
 * `null` for anything else. Shared by `GET /auth/callback` and
 * `GET /setup` — the value is NEVER trusted beyond this shape check; it
 * only ever reaches D1 through `kickPostInstallCollect`'s owned/live
 * lookup above.
 */
export function parseInstallationId(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}
