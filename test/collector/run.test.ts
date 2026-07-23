import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { upsertInstallation, upsertRepos, upsertStats, type StatsInput } from '../../src/lib/db';
import { verify } from '../../src/lib/sign';
import { runCollector } from '../../src/collector/run';

const TOKEN_URL_PATTERN = /\/app\/installations\/\d+\/access_tokens$/;
const GRAPHQL_URL = 'https://api.github.com/graphql';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function repoGraphqlResult(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: '2020-01-01T00:00:00Z',
    diskUsage: 512,
    defaultBranchRef: {
      target: {
        oid: 'head-oid',
        history: { totalCount: 10 },
        committedDate: '2026-07-20T00:00:00Z',
      },
    },
    openIssues: { totalCount: 1 },
    openPRs: { totalCount: 0 },
    languages: { totalSize: 100, edges: [{ size: 100, node: { name: 'TypeScript' } }] },
    ...overrides,
  };
}

function fixtureStats(repoId: number, overrides: Partial<StatsInput> = {}): StatsInput {
  return {
    repoId,
    collectedAt: '2026-07-20T00:00:00Z',
    commits: 10,
    lastCommitAt: '2026-07-19T00:00:00Z',
    openIssues: 0,
    openPrs: 0,
    repoCreatedAt: '2020-01-01T00:00:00Z',
    firstCommitAt: '2020-01-01T00:00:00Z',
    sizeKb: 100,
    primaryLanguage: 'TypeScript',
    languagePct: 100,
    languages: [{ name: 'TypeScript', pct: 100 }],
    payloadJson: '{}',
    signature: 'sig',
    certSerial: 'GC-000000',
    ...overrides,
  };
}

/** Routes token requests to a fixed 201, and GraphQL requests to `responses` in call order. */
function stubGithubFetch(responses: unknown[], tokenStatus = 201) {
  let graphqlCallIndex = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (TOKEN_URL_PATTERN.test(url)) {
      return tokenStatus === 201
        ? jsonResponse({ token: 'ghs_test', expires_at: '2026-07-22T13:00:00Z' }, 201)
        : new Response('forbidden', { status: tokenStatus });
    }
    if (url === GRAPHQL_URL) {
      const body = responses[graphqlCallIndex];
      graphqlCallIndex += 1;
      return jsonResponse({ data: body });
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('runCollector', () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM stats'),
      env.DB.prepare('DELETE FROM repos'),
      env.DB.prepare('DELETE FROM installations'),
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('collects a repo, signs the payload, and stores a verifiable stats row (happy path)', async () => {
    await upsertInstallation(env.DB, {
      id: 1,
      accountLogin: 'wnston',
      accountId: 100,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 1, [{ id: 10, owner: 'wnston', name: 'repo-a', private: true }]);
    stubGithubFetch([{ r0: repoGraphqlResult() }]);

    await runCollector(env, { installationId: 1, now: () => new Date('2026-07-22T12:00:00Z') });

    const row = await env.DB.prepare('SELECT * FROM stats WHERE repo_id = ?1')
      .bind(10)
      .first<{ payload_json: string; signature: string; commits: number }>();
    expect(row?.commits).toBe(10);
    expect(row?.payload_json).toContain('"repo":"wnston/repo-a"');
    await expect(verify(row!.payload_json, row!.signature, env.SIGNING_KEY)).resolves.toBe(true);
  });

  it('skips an installation whose token mint fails, without aborting other installations (error path)', async () => {
    await upsertInstallation(env.DB, {
      id: 2,
      accountLogin: 'broken',
      accountId: 200,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 2, [{ id: 20, owner: 'broken', name: 'repo-b', private: true }]);
    await upsertInstallation(env.DB, {
      id: 3,
      accountLogin: 'healthy',
      accountId: 300,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 3, [{ id: 30, owner: 'healthy', name: 'repo-c', private: false }]);

    const graphqlCalls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (TOKEN_URL_PATTERN.test(url)) {
          return url.includes('/2/')
            ? new Response('forbidden', { status: 403 })
            : jsonResponse({ token: 'ghs_ok', expires_at: '2026-07-22T13:00:00Z' }, 201);
        }
        if (url === GRAPHQL_URL) {
          graphqlCalls.push(String(init?.body));
          // totalCount: 1 so the healthy repo needs no second (first-commit) query.
          return jsonResponse({
            data: {
              r0: repoGraphqlResult({
                defaultBranchRef: {
                  target: {
                    oid: 'only',
                    history: { totalCount: 1 },
                    committedDate: '2026-07-20T00:00:00Z',
                  },
                },
              }),
            },
          });
        }
        throw new Error(`unexpected fetch to ${url}`);
      }),
    );

    const now = () => new Date('2026-07-22T12:00:00Z');
    await runCollector(env, { installationId: 2, now });
    await runCollector(env, { installationId: 3, now });

    const brokenRow = await env.DB.prepare('SELECT repo_id FROM stats WHERE repo_id = ?1')
      .bind(20)
      .first();
    expect(brokenRow).toBeNull();

    const healthyRow = await env.DB.prepare('SELECT repo_id FROM stats WHERE repo_id = ?1')
      .bind(30)
      .first();
    expect(healthyRow).not.toBeNull();
  });

  it('handles an empty repo with zero commits and issues no first-commit query (edge case)', async () => {
    await upsertInstallation(env.DB, {
      id: 4,
      accountLogin: 'wnston',
      accountId: 400,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 4, [{ id: 40, owner: 'wnston', name: 'empty-repo', private: true }]);
    const fetchMock = stubGithubFetch([
      { r0: repoGraphqlResult({ defaultBranchRef: null, languages: { totalSize: 0, edges: [] } }) },
    ]);

    await runCollector(env, { installationId: 4, now: () => new Date('2026-07-22T12:00:00Z') });

    const row = await env.DB.prepare(
      'SELECT commits, first_commit_at FROM stats WHERE repo_id = ?1',
    )
      .bind(40)
      .first<{ commits: number; first_commit_at: string | null }>();
    expect(row).toEqual({ commits: 0, first_commit_at: null });
    const graphqlCalls = fetchMock.mock.calls.filter(([input]) => String(input) === GRAPHQL_URL);
    expect(graphqlCalls).toHaveLength(1);
  });

  it('derives first_commit_at from the head commit when totalCount == 1, with no second query', async () => {
    await upsertInstallation(env.DB, {
      id: 5,
      accountLogin: 'wnston',
      accountId: 500,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 5, [{ id: 50, owner: 'wnston', name: 'one-commit', private: true }]);
    const fetchMock = stubGithubFetch([
      {
        r0: repoGraphqlResult({
          defaultBranchRef: {
            target: {
              oid: 'only',
              history: { totalCount: 1 },
              committedDate: '2026-01-01T00:00:00Z',
            },
          },
        }),
      },
    ]);

    await runCollector(env, { installationId: 5, now: () => new Date('2026-07-22T12:00:00Z') });

    const row = await env.DB.prepare('SELECT first_commit_at FROM stats WHERE repo_id = ?1')
      .bind(50)
      .first<{ first_commit_at: string | null }>();
    expect(row?.first_commit_at).toBe('2026-01-01T00:00:00Z');
    const graphqlCalls = fetchMock.mock.calls.filter(([input]) => String(input) === GRAPHQL_URL);
    expect(graphqlCalls).toHaveLength(1);
  });

  it('refetches first_commit_at when commits decreased since the stored row', async () => {
    await upsertInstallation(env.DB, {
      id: 6,
      accountLogin: 'wnston',
      accountId: 600,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 6, [{ id: 60, owner: 'wnston', name: 'rewritten', private: true }]);
    await upsertStats(
      env.DB,
      fixtureStats(60, { commits: 20, firstCommitAt: '2018-01-01T00:00:00Z' }),
    );

    stubGithubFetch([
      {
        r0: repoGraphqlResult({
          defaultBranchRef: {
            target: {
              oid: 'new-head',
              history: { totalCount: 12 },
              committedDate: '2026-07-20T00:00:00Z',
            },
          },
        }),
      },
      {
        r0: {
          defaultBranchRef: {
            target: { history: { nodes: [{ committedDate: '2022-05-01T00:00:00Z' }] } },
          },
        },
      },
    ]);

    await runCollector(env, { installationId: 6, now: () => new Date('2026-07-22T12:00:00Z') });

    const row = await env.DB.prepare('SELECT first_commit_at FROM stats WHERE repo_id = ?1')
      .bind(60)
      .first<{ first_commit_at: string | null }>();
    expect(row?.first_commit_at).toBe('2022-05-01T00:00:00Z');
  });

  it('excludes suspended installations from the stale scan', async () => {
    await upsertInstallation(env.DB, {
      id: 7,
      accountLogin: 'suspended',
      accountId: 700,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 7, [{ id: 70, owner: 'suspended', name: 'repo-d', private: true }]);
    await env.DB.prepare('UPDATE installations SET suspended_at = ?2 WHERE id = ?1')
      .bind(7, '2026-07-22T00:00:00Z')
      .run();

    const fetchMock = stubGithubFetch([]);
    await runCollector(env, { now: () => new Date('2026-07-22T12:00:00Z') });

    expect(fetchMock).not.toHaveBeenCalled();
    const row = await env.DB.prepare('SELECT repo_id FROM stats WHERE repo_id = ?1')
      .bind(70)
      .first();
    expect(row).toBeNull();
  });

  it('guards a targeted collect of a suspended installation: no token mint, no GitHub fetch (permission boundary)', async () => {
    await upsertInstallation(env.DB, {
      id: 8,
      accountLogin: 'suspended-targeted',
      accountId: 800,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 8, [
      { id: 80, owner: 'suspended-targeted', name: 'repo-e', private: true },
    ]);
    await env.DB.prepare('UPDATE installations SET suspended_at = ?2 WHERE id = ?1')
      .bind(8, '2026-07-22T00:00:00Z')
      .run();

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await runCollector(env, { installationId: 8, now: () => new Date('2026-07-22T12:00:00Z') });

    expect(fetchMock).not.toHaveBeenCalled();
    const row = await env.DB.prepare('SELECT repo_id FROM stats WHERE repo_id = ?1')
      .bind(80)
      .first();
    expect(row).toBeNull();
  });

  it('guards a targeted collect of an unknown installation: no token mint, no GitHub fetch (edge case)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await runCollector(env, {
      installationId: 999999,
      now: () => new Date('2026-07-22T12:00:00Z'),
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
