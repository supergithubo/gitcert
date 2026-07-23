import type { Env } from '../env';
import {
  selectInstallation,
  selectReposForInstallation,
  selectStaleInstallations,
  upsertStatsBatch,
  type RepoForCollection,
  type StatsInput,
} from '../lib/db';
import { buildCanonicalPayload } from '../lib/payload';
import { computeCertSerial } from '../lib/serial';
import { sign } from '../lib/sign';
import { GITHUB_USER_AGENT, mintInstallationToken } from './github';
import {
  MAX_REPOS_PER_QUERY,
  buildFirstCommitQuery,
  buildRepoStatsQuery,
  mapFirstCommitResult,
  mapRepoResult,
  type MappedRepoStats,
  type RepoGraphqlResult,
} from './query';

const STALE_THRESHOLD_MS = 60 * 60 * 1000;
const GRAPHQL_ENDPOINT = 'https://api.github.com/graphql';

export interface RunCollectorOptions {
  /** Collect exactly this installation, bypassing the staleness scan (webhook first-collect, manual refresh). */
  installationId?: number;
  /** Injectable clock for deterministic tests — defaults to the real time. */
  now?: () => Date;
}

/**
 * Collector orchestration (SPEC.md §6): stale scan (or a single targeted
 * installation) → per installation: mint token → batched GraphQL → optional
 * first-commit pass → sign → upsert stats. One bad installation is logged
 * and skipped; it never aborts the run.
 */
export async function runCollector(env: Env, options: RunCollectorOptions = {}): Promise<void> {
  const now = options.now ?? (() => new Date());
  const installationIds =
    options.installationId !== undefined
      ? [options.installationId]
      : await selectStaleInstallations(
          env.DB,
          new Date(now().getTime() - STALE_THRESHOLD_MS).toISOString(),
        );

  for (const installationId of installationIds) {
    try {
      await collectInstallation(env, installationId, now);
    } catch (error) {
      console.error(
        `gitcert collector: installation ${installationId} failed:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

async function collectInstallation(
  env: Env,
  installationId: number,
  now: () => Date,
): Promise<void> {
  // Liveness guard (spec overview Decision 8): never mint a token for an
  // unknown or suspended installation. Applies to both the cron stale scan
  // and a targeted `{ installationId }` call (webhook first-collect, manual
  // refresh) — both paths funnel through this one function.
  const installation = await selectInstallation(env.DB, installationId);
  if (!installation || installation.suspendedAt !== null) {
    console.error(
      `gitcert collector: skipping installation ${installationId} (unknown or suspended)`,
    );
    return;
  }

  const tokenResult = await mintInstallationToken(
    env.GITHUB_APP_ID,
    env.GITHUB_APP_PRIVATE_KEY,
    installationId,
    now,
  );
  if (!tokenResult) {
    console.error(`gitcert collector: failed to mint a token for installation ${installationId}`);
    return;
  }

  const repos = await selectReposForInstallation(env.DB, installationId);
  const statsInputs: StatsInput[] = [];
  for (const repoChunk of chunk(repos, MAX_REPOS_PER_QUERY)) {
    statsInputs.push(...(await collectRepoChunk(env, tokenResult.token, repoChunk, now)));
  }
  await upsertStatsBatch(env.DB, statsInputs);
}

interface RepoTarget extends RepoForCollection {
  alias: string;
}

async function collectRepoChunk(
  env: Env,
  token: string,
  repos: RepoForCollection[],
  now: () => Date,
): Promise<StatsInput[]> {
  const repoTargets: RepoTarget[] = repos.map((repo, index) => ({ ...repo, alias: `r${index}` }));
  const data = await runGraphqlQuery(token, buildRepoStatsQuery(repoTargets));
  if (!data) return [];

  const mapped = repoTargets.map((target) =>
    mapRepoResult((data[target.alias] ?? null) as RepoGraphqlResult | null),
  );
  const firstCommitDates = await resolveFirstCommitDates(token, repoTargets, mapped);

  const inputs: StatsInput[] = [];
  for (let index = 0; index < repoTargets.length; index += 1) {
    const target = repoTargets[index];
    const stats = mapped[index];
    if (!target || !stats) continue;
    inputs.push(await buildStatsInput(env, target, stats, firstCommitDates[index] ?? null, now));
  }
  return inputs;
}

interface PendingFirstCommit {
  index: number;
  alias: string;
  owner: string;
  name: string;
  headOid: string;
  totalCount: number;
}

/** Decides, per repo, whether `first_commit_at` can reuse the stored value, is derivable for free (totalCount 1), or needs a second query — then runs that second query once for the whole chunk. */
async function resolveFirstCommitDates(
  token: string,
  repoTargets: RepoTarget[],
  mapped: Array<MappedRepoStats | null>,
): Promise<Array<string | null>> {
  const resolved: Array<string | null> = new Array(repoTargets.length).fill(null);
  const pending: PendingFirstCommit[] = [];

  repoTargets.forEach((target, index) => {
    const stats = mapped[index];
    if (!stats) return;
    if (stats.commits === 1) {
      resolved[index] = stats.lastCommitAt;
    } else if (stats.commits > 1 && needsFirstCommitRefetch(target, stats) && stats.headOid) {
      pending.push({
        index,
        alias: target.alias,
        owner: target.owner,
        name: target.name,
        headOid: stats.headOid,
        totalCount: stats.commits,
      });
    } else {
      resolved[index] = target.previousFirstCommitAt;
    }
  });

  if (pending.length > 0) {
    const data = await runGraphqlQuery(token, buildFirstCommitQuery(pending));
    for (const item of pending) {
      const result = (data?.[item.alias] ?? null) as Parameters<typeof mapFirstCommitResult>[0];
      resolved[item.index] = mapFirstCommitResult(result);
    }
  }
  return resolved;
}

function needsFirstCommitRefetch(repo: RepoForCollection, mapped: MappedRepoStats): boolean {
  if (repo.previousFirstCommitAt === null) return true;
  return repo.previousCommits !== null && mapped.commits < repo.previousCommits;
}

async function buildStatsInput(
  env: Env,
  repo: RepoForCollection,
  mapped: MappedRepoStats,
  firstCommitAt: string | null,
  now: () => Date,
): Promise<StatsInput> {
  const collectedAt = now().toISOString();
  const certSerial = await computeCertSerial(repo.id, collectedAt);
  const payloadJson = buildCanonicalPayload({
    certSerial,
    collectedAt,
    repo: `${repo.owner}/${repo.name}`,
    private: repo.private,
    stats: {
      commits: mapped.commits,
      createdAt: mapped.createdAt,
      firstCommitAt,
      languagePct: mapped.languagePct,
      languages: mapped.languages,
      lastCommitAt: mapped.lastCommitAt,
      openIssues: mapped.openIssues,
      openPrs: mapped.openPrs,
      primaryLanguage: mapped.primaryLanguage,
      sizeKb: mapped.sizeKb,
    },
  });
  const signature = await sign(payloadJson, env.SIGNING_KEY);
  return {
    repoId: repo.id,
    collectedAt,
    commits: mapped.commits,
    lastCommitAt: mapped.lastCommitAt,
    openIssues: mapped.openIssues,
    openPrs: mapped.openPrs,
    repoCreatedAt: mapped.createdAt,
    firstCommitAt,
    sizeKb: mapped.sizeKb,
    primaryLanguage: mapped.primaryLanguage,
    languagePct: mapped.languagePct,
    languages: mapped.languages,
    payloadJson,
    signature,
    certSerial,
  };
}

async function runGraphqlQuery(
  token: string,
  query: string,
): Promise<Record<string, unknown> | null> {
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': GITHUB_USER_AGENT,
    },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) {
    console.error(`gitcert collector: GraphQL request failed with status ${response.status}`);
    return null;
  }
  const body = (await response.json()) as { data?: Record<string, unknown>; errors?: unknown };
  return body.data ?? null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
