import type { LanguageShare } from '../lib/types';

/**
 * Aliased GraphQL query builders and response mappers (SPEC.md §6). Pure
 * functions only — no `fetch` here, so these are unit-testable without
 * mocking the network. The network call itself lives in `collector/run.ts`.
 */

export const MAX_REPOS_PER_QUERY = 20;

export interface RepoQueryTarget {
  alias: string;
  owner: string;
  name: string;
}

export interface RepoGraphqlResult {
  createdAt: string;
  diskUsage: number | null;
  defaultBranchRef: {
    target: {
      oid: string;
      history: { totalCount: number };
      committedDate: string;
    } | null;
  } | null;
  openIssues: { totalCount: number };
  openPRs: { totalCount: number };
  languages: {
    totalSize: number;
    edges: Array<{ size: number; node: { name: string } }>;
  };
}

export interface MappedRepoStats {
  commits: number;
  headOid: string | null;
  lastCommitAt: string | null;
  createdAt: string;
  sizeKb: number | null;
  openIssues: number;
  openPrs: number;
  primaryLanguage: string | null;
  languagePct: number | null;
  languages: LanguageShare[];
}

/** Builds one aliased GraphQL query covering up to `MAX_REPOS_PER_QUERY` repos (SPEC.md §6 step 3). */
export function buildRepoStatsQuery(targets: RepoQueryTarget[]): string {
  const fields = targets.map(
    (target) => `
  ${target.alias}: repository(owner: ${JSON.stringify(target.owner)}, name: ${JSON.stringify(target.name)}) {
    createdAt
    diskUsage
    defaultBranchRef {
      target {
        ... on Commit {
          oid
          history { totalCount }
          committedDate
        }
      }
    }
    openIssues: issues(states: OPEN) { totalCount }
    openPRs: pullRequests(states: OPEN) { totalCount }
    languages(first: 5, orderBy: { field: SIZE, direction: DESC }) {
      totalSize
      edges { size node { name } }
    }
  }`,
  );
  return `query {${fields.join('')}\n}`;
}

/** Maps one repo's raw GraphQL result to typed stats; `null` in (repo inaccessible/removed) yields `null` out. */
export function mapRepoResult(result: RepoGraphqlResult | null): MappedRepoStats | null {
  if (!result) return null;
  const commit = result.defaultBranchRef?.target ?? null;
  const languages = mapLanguages(result.languages);
  return {
    commits: commit?.history.totalCount ?? 0,
    headOid: commit?.oid ?? null,
    lastCommitAt: commit?.committedDate ?? null,
    createdAt: result.createdAt,
    sizeKb: result.diskUsage,
    openIssues: result.openIssues.totalCount,
    openPrs: result.openPRs.totalCount,
    primaryLanguage: languages[0]?.name ?? null,
    languagePct: languages[0]?.pct ?? null,
    languages,
  };
}

function mapLanguages(languages: RepoGraphqlResult['languages']): LanguageShare[] {
  if (languages.totalSize === 0) return [];
  return languages.edges.map((edge) => ({
    name: edge.node.name,
    pct: Math.round((edge.size / languages.totalSize) * 1000) / 10,
  }));
}

export interface FirstCommitTarget {
  alias: string;
  owner: string;
  name: string;
  headOid: string;
  totalCount: number;
}

export interface FirstCommitGraphqlResult {
  defaultBranchRef: {
    target: {
      history: { nodes: Array<{ committedDate: string }> };
    } | null;
  } | null;
}

/**
 * Builds the second-pass aliased query for repos whose `first_commit_at` is
 * unknown or needs a refetch, using GraphQL's positional cursor
 * (`"<head_oid> <totalCount - 2>"`) to land on the oldest commit in one hop
 * (SPEC.md §6 step 4). Callers must not call this for `totalCount === 1`
 * repos — the head commit IS the first commit in that case.
 */
export function buildFirstCommitQuery(targets: FirstCommitTarget[]): string {
  const fields = targets.map((target) => {
    const cursor = `${target.headOid} ${target.totalCount - 2}`;
    return `
  ${target.alias}: repository(owner: ${JSON.stringify(target.owner)}, name: ${JSON.stringify(target.name)}) {
    defaultBranchRef {
      target {
        ... on Commit {
          history(first: 1, after: ${JSON.stringify(cursor)}) {
            nodes { committedDate }
          }
        }
      }
    }
  }`;
  });
  return `query {${fields.join('')}\n}`;
}

/** Extracts the oldest commit's `committedDate` from a first-commit query result, or `null` if absent. */
export function mapFirstCommitResult(result: FirstCommitGraphqlResult | null): string | null {
  return result?.defaultBranchRef?.target?.history.nodes[0]?.committedDate ?? null;
}
