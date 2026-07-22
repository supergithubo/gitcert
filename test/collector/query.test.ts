import { describe, expect, it } from 'vitest';
import {
  buildFirstCommitQuery,
  buildRepoStatsQuery,
  mapFirstCommitResult,
  mapRepoResult,
  type RepoGraphqlResult,
} from '../../src/collector/query';

describe('buildRepoStatsQuery', () => {
  it('aliases each repo and embeds owner/name (happy path)', () => {
    const query = buildRepoStatsQuery([
      { alias: 'r0', owner: 'wnston', name: 'client-platform' },
      { alias: 'r1', owner: 'wnston', name: 'gitcert' },
    ]);
    expect(query).toContain('r0: repository(owner: "wnston", name: "client-platform")');
    expect(query).toContain('r1: repository(owner: "wnston", name: "gitcert")');
    expect(query).toContain('history { totalCount }');
    expect(query).toContain('languages(first: 5, orderBy: { field: SIZE, direction: DESC })');
  });

  it('produces a single alias for one repo (edge case)', () => {
    const query = buildRepoStatsQuery([{ alias: 'r0', owner: 'a', name: 'b' }]);
    expect(query.match(/repository\(/g)).toHaveLength(1);
  });
});

function fixtureResult(overrides: Partial<RepoGraphqlResult> = {}): RepoGraphqlResult {
  return {
    createdAt: '2020-01-01T00:00:00Z',
    diskUsage: 1024,
    defaultBranchRef: {
      target: {
        oid: 'abc123',
        history: { totalCount: 50 },
        committedDate: '2026-07-20T00:00:00Z',
      },
    },
    openIssues: { totalCount: 2 },
    openPRs: { totalCount: 1 },
    languages: {
      totalSize: 1000,
      edges: [
        { size: 800, node: { name: 'TypeScript' } },
        { size: 200, node: { name: 'JavaScript' } },
      ],
    },
    ...overrides,
  };
}

describe('mapRepoResult', () => {
  it('maps a full result to typed stats (happy path)', () => {
    const mapped = mapRepoResult(fixtureResult());
    expect(mapped).toEqual({
      commits: 50,
      headOid: 'abc123',
      lastCommitAt: '2026-07-20T00:00:00Z',
      createdAt: '2020-01-01T00:00:00Z',
      sizeKb: 1024,
      openIssues: 2,
      openPrs: 1,
      primaryLanguage: 'TypeScript',
      languagePct: 80,
      languages: [
        { name: 'TypeScript', pct: 80 },
        { name: 'JavaScript', pct: 20 },
      ],
    });
  });

  it('returns null when the repo result itself is null (error/permission path — inaccessible repo)', () => {
    expect(mapRepoResult(null)).toBeNull();
  });

  it('handles an empty repo with no default branch commits (edge case)', () => {
    const mapped = mapRepoResult(
      fixtureResult({
        defaultBranchRef: null,
        languages: { totalSize: 0, edges: [] },
      }),
    );
    expect(mapped).toMatchObject({
      commits: 0,
      headOid: null,
      lastCommitAt: null,
      primaryLanguage: null,
      languagePct: null,
      languages: [],
    });
  });

  it('handles totalCount == 1 (head commit is the only commit)', () => {
    const mapped = mapRepoResult(
      fixtureResult({
        defaultBranchRef: {
          target: {
            oid: 'onlyoid',
            history: { totalCount: 1 },
            committedDate: '2026-01-01T00:00:00Z',
          },
        },
      }),
    );
    expect(mapped?.commits).toBe(1);
    expect(mapped?.lastCommitAt).toBe('2026-01-01T00:00:00Z');
  });
});

describe('buildFirstCommitQuery', () => {
  it('builds the positional cursor from head oid and totalCount - 2 (happy path)', () => {
    const query = buildFirstCommitQuery([
      { alias: 'r0', owner: 'wnston', name: 'client-platform', headOid: 'abc123', totalCount: 50 },
    ]);
    expect(query).toContain('history(first: 1, after: "abc123 48")');
  });
});

describe('mapFirstCommitResult', () => {
  it('extracts the oldest commit date (happy path)', () => {
    const result = mapFirstCommitResult({
      defaultBranchRef: {
        target: { history: { nodes: [{ committedDate: '2019-01-01T00:00:00Z' }] } },
      },
    });
    expect(result).toBe('2019-01-01T00:00:00Z');
  });

  it('returns null when no node is present (edge case)', () => {
    expect(
      mapFirstCommitResult({ defaultBranchRef: { target: { history: { nodes: [] } } } }),
    ).toBeNull();
    expect(mapFirstCommitResult(null)).toBeNull();
  });
});
