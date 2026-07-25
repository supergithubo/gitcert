import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  countAttestedRepos,
  markRepoRemoved,
  replaceInstallationLinks,
  selectInstallation,
  selectOldestCollectedAt,
  selectOwnedRepo,
  selectOwnedRepos,
  selectPublicRepoState,
  selectReposForInstallation,
  selectStaleInstallations,
  suspendInstallation,
  unsuspendInstallation,
  updateRepo,
  updateRepoIncluded,
  upsertInstallation,
  upsertRepos,
  upsertStats,
  upsertStatsBatch,
  type StatsInput,
} from '../../src/lib/db';

function fixtureStats(repoId: number, overrides: Partial<StatsInput> = {}): StatsInput {
  return {
    repoId,
    collectedAt: '2026-07-22T00:00:00Z',
    commits: 10,
    lastCommitAt: '2026-07-21T00:00:00Z',
    openIssues: 1,
    openPrs: 0,
    repoCreatedAt: '2020-01-01T00:00:00Z',
    firstCommitAt: '2020-01-01T00:00:00Z',
    sizeKb: 100,
    primaryLanguage: 'TypeScript',
    languagePct: 90,
    languages: [{ name: 'TypeScript', pct: 90 }],
    payloadJson: '{"v":1}',
    signature: 'sig',
    certSerial: 'GC-000000',
    ...overrides,
  };
}

/** Test-only shortcut for seeding an `installation_users` link row (the reconcile itself is unit-tested via `replaceInstallationLinks`). */
async function linkUser(installationId: number, githubUserId: number): Promise<void> {
  await env.DB.prepare(
    'INSERT OR IGNORE INTO installation_users (installation_id, github_user_id) VALUES (?1, ?2)',
  )
    .bind(installationId, githubUserId)
    .run();
}

describe('db.ts', () => {
  beforeEach(async () => {
    // Isolated per-test D1 (migrations applied in test/setup.ts) — clear
    // rows between tests instead of relying on isolation across files only.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM installation_users'),
      env.DB.prepare('DELETE FROM stats'),
      env.DB.prepare('DELETE FROM repos'),
      env.DB.prepare('DELETE FROM installations'),
    ]);
  });

  it('upsertInstallation inserts then reactivates on re-install (happy path)', async () => {
    await upsertInstallation(env.DB, {
      id: 1,
      accountLogin: 'wnston',
      accountId: 100,
      accountType: 'User',
    });
    await suspendInstallation(env.DB, 1, '2026-07-22T00:00:00Z');
    await upsertInstallation(env.DB, {
      id: 1,
      accountLogin: 'wnston',
      accountId: 100,
      accountType: 'User',
    });
    const row = await env.DB.prepare('SELECT suspended_at FROM installations WHERE id = ?1')
      .bind(1)
      .first<{ suspended_at: string | null }>();
    expect(row?.suspended_at).toBeNull();
  });

  it('suspendInstallation then unsuspendInstallation toggles suspended_at', async () => {
    await upsertInstallation(env.DB, {
      id: 2,
      accountLogin: 'acme',
      accountId: 200,
      accountType: 'Organization',
    });
    await suspendInstallation(env.DB, 2, '2026-07-22T00:00:00Z');
    let row = await env.DB.prepare('SELECT suspended_at FROM installations WHERE id = ?1')
      .bind(2)
      .first<{ suspended_at: string | null }>();
    expect(row?.suspended_at).toBe('2026-07-22T00:00:00Z');

    await unsuspendInstallation(env.DB, 2);
    row = await env.DB.prepare('SELECT suspended_at FROM installations WHERE id = ?1')
      .bind(2)
      .first<{ suspended_at: string | null }>();
    expect(row?.suspended_at).toBeNull();
  });

  it('upsertRepos batches inserts and reactivates a removed repo', async () => {
    await upsertInstallation(env.DB, {
      id: 3,
      accountLogin: 'wnston',
      accountId: 300,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 3, [
      { id: 10, owner: 'wnston', name: 'repo-a', private: true },
      { id: 11, owner: 'wnston', name: 'repo-b', private: false },
    ]);
    await markRepoRemoved(env.DB, 10, '2026-07-22T00:00:00Z');
    await upsertRepos(env.DB, 3, [{ id: 10, owner: 'wnston', name: 'repo-a', private: true }]);

    const row = await env.DB.prepare('SELECT removed_at FROM repos WHERE id = ?1')
      .bind(10)
      .first<{ removed_at: string | null }>();
    expect(row?.removed_at).toBeNull();
  });

  it('updateRepo applies a partial rename without touching other fields', async () => {
    await upsertInstallation(env.DB, {
      id: 4,
      accountLogin: 'wnston',
      accountId: 400,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 4, [{ id: 20, owner: 'wnston', name: 'old-name', private: true }]);
    await updateRepo(env.DB, 20, { name: 'new-name' });

    const row = await env.DB.prepare('SELECT owner, name, private FROM repos WHERE id = ?1')
      .bind(20)
      .first<{ owner: string; name: string; private: number }>();
    expect(row).toEqual({ owner: 'wnston', name: 'new-name', private: 1 });
  });

  it('updateRepo is a no-op when given an empty update (edge case)', async () => {
    await upsertInstallation(env.DB, {
      id: 5,
      accountLogin: 'wnston',
      accountId: 500,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 5, [{ id: 30, owner: 'wnston', name: 'repo-c', private: true }]);
    await expect(updateRepo(env.DB, 30, {})).resolves.toBeUndefined();
  });

  it('selectStaleInstallations excludes suspended installations and fresh repos', async () => {
    await upsertInstallation(env.DB, {
      id: 6,
      accountLogin: 'stale-owner',
      accountId: 600,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 6, [{ id: 40, owner: 'stale-owner', name: 'repo-d', private: true }]);
    // No stats row yet -> missing, counts as stale.

    await upsertInstallation(env.DB, {
      id: 7,
      accountLogin: 'suspended-owner',
      accountId: 700,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 7, [
      { id: 41, owner: 'suspended-owner', name: 'repo-e', private: true },
    ]);
    await suspendInstallation(env.DB, 7, '2026-07-22T00:00:00Z');

    await upsertInstallation(env.DB, {
      id: 8,
      accountLogin: 'fresh-owner',
      accountId: 800,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 8, [{ id: 42, owner: 'fresh-owner', name: 'repo-f', private: true }]);
    await upsertStats(env.DB, fixtureStats(42, { collectedAt: '2026-07-22T23:00:00Z' }));

    const stale = await selectStaleInstallations(env.DB, '2026-07-22T22:00:00Z');
    expect(stale).toEqual([6]);
  });

  it('selectStaleInstallations orders oldest-stats-first, never-collected first (Decision 8)', async () => {
    // id 100: has a stats row from a while back.
    await upsertInstallation(env.DB, {
      id: 100,
      accountLogin: 'older-stats',
      accountId: 10000,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 100, [
      { id: 1000, owner: 'older-stats', name: 'repo', private: true },
    ]);
    await upsertStats(env.DB, fixtureStats(1000, { collectedAt: '2020-01-01T00:00:00Z' }));

    // id 101: never collected — must sort before id 100 despite being inserted after.
    await upsertInstallation(env.DB, {
      id: 101,
      accountLogin: 'never-collected',
      accountId: 10100,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 101, [
      { id: 1010, owner: 'never-collected', name: 'repo', private: true },
    ]);

    // id 102: more recent stale stats — sorts last.
    await upsertInstallation(env.DB, {
      id: 102,
      accountLogin: 'newer-stats',
      accountId: 10200,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 102, [
      { id: 1020, owner: 'newer-stats', name: 'repo', private: true },
    ]);
    await upsertStats(env.DB, fixtureStats(1020, { collectedAt: '2025-01-01T00:00:00Z' }));

    const stale = await selectStaleInstallations(env.DB, '2026-07-22T22:00:00Z');
    expect(stale).toEqual([101, 100, 102]);
  });

  it('selectStaleInstallations caps at LIMIT 15 (edge case)', async () => {
    for (let i = 0; i < 20; i += 1) {
      const installationId = 2000 + i;
      await upsertInstallation(env.DB, {
        id: installationId,
        accountLogin: `bulk-${i}`,
        accountId: 20000 + i,
        accountType: 'User',
      });
      await upsertRepos(env.DB, installationId, [
        { id: 20000 + i, owner: `bulk-${i}`, name: 'repo', private: true },
      ]);
    }

    const stale = await selectStaleInstallations(env.DB, '2026-07-22T22:00:00Z');
    expect(stale).toHaveLength(15);
  });

  describe('selectInstallation', () => {
    it('returns id + suspendedAt for a known installation (happy path)', async () => {
      await upsertInstallation(env.DB, {
        id: 110,
        accountLogin: 'wnston',
        accountId: 11000,
        accountType: 'User',
      });

      await expect(selectInstallation(env.DB, 110)).resolves.toEqual({
        id: 110,
        suspendedAt: null,
      });
    });

    it('reflects a suspended installation', async () => {
      await upsertInstallation(env.DB, {
        id: 111,
        accountLogin: 'suspended-owner',
        accountId: 11100,
        accountType: 'User',
      });
      await suspendInstallation(env.DB, 111, '2026-07-22T00:00:00Z');

      await expect(selectInstallation(env.DB, 111)).resolves.toEqual({
        id: 111,
        suspendedAt: '2026-07-22T00:00:00Z',
      });
    });

    it('returns null for an unknown installation (edge case)', async () => {
      await expect(selectInstallation(env.DB, 999999)).resolves.toBeNull();
    });
  });

  it('selectReposForInstallation returns previous stats for staleness/first-commit decisions', async () => {
    await upsertInstallation(env.DB, {
      id: 9,
      accountLogin: 'wnston',
      accountId: 900,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 9, [{ id: 50, owner: 'wnston', name: 'repo-g', private: true }]);
    await upsertStats(
      env.DB,
      fixtureStats(50, { commits: 42, firstCommitAt: '2019-01-01T00:00:00Z' }),
    );

    const repos = await selectReposForInstallation(env.DB, 9);
    expect(repos).toEqual([
      {
        id: 50,
        owner: 'wnston',
        name: 'repo-g',
        private: true,
        previousCommits: 42,
        previousFirstCommitAt: '2019-01-01T00:00:00Z',
      },
    ]);
  });

  it('upsertStatsBatch writes multiple repos in one round trip', async () => {
    await upsertInstallation(env.DB, {
      id: 10,
      accountLogin: 'wnston',
      accountId: 1000,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 10, [
      { id: 60, owner: 'wnston', name: 'repo-h', private: true },
      { id: 61, owner: 'wnston', name: 'repo-i', private: true },
    ]);
    await upsertStatsBatch(env.DB, [fixtureStats(60), fixtureStats(61, { commits: 5 })]);

    const rows = await env.DB.prepare('SELECT repo_id, commits FROM stats ORDER BY repo_id').all<{
      repo_id: number;
      commits: number;
    }>();
    expect(rows.results).toEqual([
      { repo_id: 60, commits: 10 },
      { repo_id: 61, commits: 5 },
    ]);
  });

  describe('selectPublicRepoState', () => {
    it('returns hidden for an unknown owner/name (edge case: no existence oracle)', async () => {
      const state = await selectPublicRepoState(env.DB, 'nobody', 'nothing');
      expect(state).toEqual({ visibility: 'hidden' });
    });

    it('returns hidden for an excluded repo (included = 0), byte-identical to unknown', async () => {
      await upsertInstallation(env.DB, {
        id: 20,
        accountLogin: 'wnston',
        accountId: 2000,
        accountType: 'User',
      });
      await upsertRepos(env.DB, 20, [
        { id: 200, owner: 'wnston', name: 'excluded-repo', private: true },
      ]);
      await env.DB.prepare('UPDATE repos SET included = 0 WHERE id = ?1').bind(200).run();

      const state = await selectPublicRepoState(env.DB, 'wnston', 'excluded-repo');
      expect(state).toEqual({ visibility: 'hidden' });
    });

    it('returns hidden for a removed repo, byte-identical to unknown', async () => {
      await upsertInstallation(env.DB, {
        id: 21,
        accountLogin: 'wnston',
        accountId: 2100,
        accountType: 'User',
      });
      await upsertRepos(env.DB, 21, [
        { id: 210, owner: 'wnston', name: 'removed-repo', private: true },
      ]);
      await markRepoRemoved(env.DB, 210, '2026-07-22T00:00:00Z');

      const state = await selectPublicRepoState(env.DB, 'wnston', 'removed-repo');
      expect(state).toEqual({ visibility: 'hidden' });
    });

    it('returns hidden when the owning installation is suspended, byte-identical to unknown', async () => {
      await upsertInstallation(env.DB, {
        id: 22,
        accountLogin: 'suspended-owner',
        accountId: 2200,
        accountType: 'User',
      });
      await upsertRepos(env.DB, 22, [
        { id: 220, owner: 'suspended-owner', name: 'suspended-repo', private: true },
      ]);
      await suspendInstallation(env.DB, 22, '2026-07-22T00:00:00Z');

      const state = await selectPublicRepoState(env.DB, 'suspended-owner', 'suspended-repo');
      expect(state).toEqual({ visibility: 'hidden' });
    });

    it('returns collecting for a live, included repo with no stats row yet', async () => {
      await upsertInstallation(env.DB, {
        id: 23,
        accountLogin: 'wnston',
        accountId: 2300,
        accountType: 'User',
      });
      await upsertRepos(env.DB, 23, [
        { id: 230, owner: 'wnston', name: 'new-repo', private: true },
      ]);

      const state = await selectPublicRepoState(env.DB, 'wnston', 'new-repo');
      expect(state).toEqual({
        visibility: 'collecting',
        repo: { owner: 'wnston', name: 'new-repo', private: true },
      });
    });

    it('returns ready with mapped stats and the verbatim signed payload (happy path)', async () => {
      await upsertInstallation(env.DB, {
        id: 24,
        accountLogin: 'wnston',
        accountId: 2400,
        accountType: 'User',
      });
      await upsertRepos(env.DB, 24, [
        { id: 240, owner: 'wnston', name: 'ready-repo', private: true },
      ]);
      await upsertStats(
        env.DB,
        fixtureStats(240, {
          payloadJson: '{"cert_serial":"GC-ABCDEF"}',
          signature: 'sig-240',
          certSerial: 'GC-ABCDEF',
        }),
      );

      const state = await selectPublicRepoState(env.DB, 'wnston', 'ready-repo');
      expect(state).toEqual({
        visibility: 'ready',
        repo: { owner: 'wnston', name: 'ready-repo', private: true },
        stats: {
          commits: 10,
          lastCommitAt: '2026-07-21T00:00:00Z',
          openIssues: 1,
          openPrs: 0,
          repoCreatedAt: '2020-01-01T00:00:00Z',
          firstCommitAt: '2020-01-01T00:00:00Z',
          sizeKb: 100,
          primaryLanguage: 'TypeScript',
          languagePct: 90,
          languages: [{ name: 'TypeScript', pct: 90 }],
        },
        payloadJson: '{"cert_serial":"GC-ABCDEF"}',
        signature: 'sig-240',
        certSerial: 'GC-ABCDEF',
        collectedAt: '2026-07-22T00:00:00Z',
      });
    });
  });

  describe('selectOldestCollectedAt', () => {
    it('returns null when no stats exist yet (edge case)', async () => {
      await expect(selectOldestCollectedAt(env.DB)).resolves.toBeNull();
    });

    it('returns the minimum collected_at across included, live repos only (happy path)', async () => {
      await upsertInstallation(env.DB, {
        id: 25,
        accountLogin: 'wnston',
        accountId: 2500,
        accountType: 'User',
      });
      await upsertRepos(env.DB, 25, [
        { id: 250, owner: 'wnston', name: 'old-repo', private: true },
        { id: 251, owner: 'wnston', name: 'new-repo', private: true },
      ]);
      await upsertStats(env.DB, fixtureStats(250, { collectedAt: '2026-07-01T00:00:00Z' }));
      await upsertStats(env.DB, fixtureStats(251, { collectedAt: '2026-07-22T00:00:00Z' }));

      // A suspended installation's fresher stats must not win the MIN.
      await upsertInstallation(env.DB, {
        id: 26,
        accountLogin: 'suspended-owner',
        accountId: 2600,
        accountType: 'User',
      });
      await upsertRepos(env.DB, 26, [
        { id: 260, owner: 'suspended-owner', name: 'suspended-repo', private: true },
      ]);
      await upsertStats(env.DB, fixtureStats(260, { collectedAt: '2020-01-01T00:00:00Z' }));
      await suspendInstallation(env.DB, 26, '2026-07-22T00:00:00Z');

      await expect(selectOldestCollectedAt(env.DB)).resolves.toBe('2026-07-01T00:00:00Z');
    });
  });

  describe('selectOwnedRepos', () => {
    it('lists only the linked tenant repos, sorted (owner, name) (happy path)', async () => {
      await upsertInstallation(env.DB, {
        id: 30,
        accountLogin: 'wnston',
        accountId: 3000,
        accountType: 'User',
      });
      await linkUser(30, 3000);
      await upsertRepos(env.DB, 30, [
        { id: 301, owner: 'wnston', name: 'zeta', private: true },
        { id: 302, owner: 'wnston', name: 'alpha', private: false },
      ]);
      await upsertStats(env.DB, fixtureStats(301, { collectedAt: '2026-07-20T00:00:00Z' }));
      await upsertStats(env.DB, fixtureStats(302, { collectedAt: '2026-07-22T00:00:00Z' }));

      // A different tenant's repo must never appear, even unlinked-installation noise.
      await upsertInstallation(env.DB, {
        id: 31,
        accountLogin: 'other',
        accountId: 3100,
        accountType: 'User',
      });
      await linkUser(31, 3100);
      await upsertRepos(env.DB, 31, [{ id: 310, owner: 'other', name: 'repo', private: true }]);

      const result = await selectOwnedRepos(env.DB, 3000);
      expect(result).toEqual({
        accounts: [
          {
            installationId: 30,
            accountLogin: 'wnston',
            accountType: 'User',
            repos: [
              {
                id: 302,
                owner: 'wnston',
                name: 'alpha',
                private: false,
                included: true,
                collectedAt: '2026-07-22T00:00:00Z',
              },
              {
                id: 301,
                owner: 'wnston',
                name: 'zeta',
                private: true,
                included: true,
                collectedAt: '2026-07-20T00:00:00Z',
              },
            ],
          },
        ],
      });
    });

    it('still lists excluded (included = 0) rows — greyed, not hidden (Decision 7) — and null collectedAt when uncollected', async () => {
      await upsertInstallation(env.DB, {
        id: 32,
        accountLogin: 'wnston',
        accountId: 3200,
        accountType: 'User',
      });
      await linkUser(32, 3200);
      await upsertRepos(env.DB, 32, [
        { id: 320, owner: 'wnston', name: 'excluded', private: true },
      ]);
      await env.DB.prepare('UPDATE repos SET included = 0 WHERE id = ?1').bind(320).run();

      const result = await selectOwnedRepos(env.DB, 3200);
      expect(result.accounts[0]?.repos).toEqual([
        {
          id: 320,
          owner: 'wnston',
          name: 'excluded',
          private: true,
          included: false,
          collectedAt: null,
        },
      ]);
    });

    it('excludes removed repos and every repo of a suspended installation, even when linked', async () => {
      await upsertInstallation(env.DB, {
        id: 33,
        accountLogin: 'wnston',
        accountId: 3300,
        accountType: 'User',
      });
      await linkUser(33, 3300);
      await upsertRepos(env.DB, 33, [
        { id: 330, owner: 'wnston', name: 'removed-repo', private: true },
      ]);
      await markRepoRemoved(env.DB, 330, '2026-07-22T00:00:00Z');

      await upsertInstallation(env.DB, {
        id: 34,
        accountLogin: 'wnston-suspended',
        accountId: 3300,
        accountType: 'User',
      });
      await linkUser(34, 3300);
      await upsertRepos(env.DB, 34, [
        { id: 340, owner: 'wnston-suspended', name: 'suspended-repo', private: true },
      ]);
      await suspendInstallation(env.DB, 34, '2026-07-22T00:00:00Z');

      const result = await selectOwnedRepos(env.DB, 3300);
      // Installation 34 is suspended, so it never yields a group at all
      // (byte-identical to unlinked). Installation 33 IS live and linked,
      // but its only repo is removed — this also covers "installation
      // with zero live repos still yields a group with `repos: []`"
      // (Decision D2).
      expect(result).toEqual({
        accounts: [{ installationId: 33, accountLogin: 'wnston', accountType: 'User', repos: [] }],
      });
    });

    it('an installation with zero live repos yields a group with an empty repos array (Decision D2, edge case)', async () => {
      await upsertInstallation(env.DB, {
        id: 35,
        accountLogin: 'wnston',
        accountId: 3500,
        accountType: 'User',
      });
      await linkUser(35, 3500);
      // No repos at all.

      await expect(selectOwnedRepos(env.DB, 3500)).resolves.toEqual({
        accounts: [{ installationId: 35, accountLogin: 'wnston', accountType: 'User', repos: [] }],
      });
    });

    it('groups a linked organization installation separately, ordered personal-first then orgs alphabetical (happy path — org installations)', async () => {
      await upsertInstallation(env.DB, {
        id: 36,
        accountLogin: 'wnston',
        accountId: 3600,
        accountType: 'User',
      });
      await linkUser(36, 3600);
      await upsertRepos(env.DB, 36, [
        { id: 360, owner: 'wnston', name: 'personal-repo', private: true },
      ]);

      await upsertInstallation(env.DB, {
        id: 37,
        accountLogin: 'zzz-org',
        accountId: 9999,
        accountType: 'Organization',
      });
      await linkUser(37, 3600);
      await upsertRepos(env.DB, 37, [{ id: 370, owner: 'zzz-org', name: 'z-repo', private: true }]);

      await upsertInstallation(env.DB, {
        id: 38,
        accountLogin: 'aaa-org',
        accountId: 9998,
        accountType: 'Organization',
      });
      await linkUser(38, 3600);
      await upsertRepos(env.DB, 38, [{ id: 380, owner: 'aaa-org', name: 'a-repo', private: true }]);

      const result = await selectOwnedRepos(env.DB, 3600);
      expect(
        result.accounts.map((a) => ({
          installationId: a.installationId,
          accountType: a.accountType,
          accountLogin: a.accountLogin,
        })),
      ).toEqual([
        { installationId: 36, accountType: 'User', accountLogin: 'wnston' },
        { installationId: 38, accountType: 'Organization', accountLogin: 'aaa-org' },
        { installationId: 37, accountType: 'Organization', accountLogin: 'zzz-org' },
      ]);
    });

    it('an organization installation without a link is invisible even though repos exist (permission boundary)', async () => {
      await upsertInstallation(env.DB, {
        id: 39,
        accountLogin: 'other-org',
        accountId: 8888,
        accountType: 'Organization',
      });
      // Deliberately NOT linking installation 39 to githubUserId 3700.
      await upsertRepos(env.DB, 39, [{ id: 390, owner: 'other-org', name: 'repo', private: true }]);

      await expect(selectOwnedRepos(env.DB, 3700)).resolves.toEqual({
        accounts: [],
      });
    });

    it('a second user’s link to a different org does not expose the first user’s org (permission boundary — cross-tenant org isolation)', async () => {
      await upsertInstallation(env.DB, {
        id: 45,
        accountLogin: 'acme',
        accountId: 7000,
        accountType: 'Organization',
      });
      await linkUser(45, 4501);
      await upsertRepos(env.DB, 45, [{ id: 450, owner: 'acme', name: 'repo', private: true }]);

      await upsertInstallation(env.DB, {
        id: 46,
        accountLogin: 'beta',
        accountId: 7100,
        accountType: 'Organization',
      });
      await linkUser(46, 4502);
      await upsertRepos(env.DB, 46, [{ id: 460, owner: 'beta', name: 'repo', private: true }]);

      const result = await selectOwnedRepos(env.DB, 4501);
      expect(result.accounts).toHaveLength(1);
      expect(result.accounts[0]?.installationId).toBe(45);
    });

    it('returns an empty result for a tenant with no linked installations (edge case)', async () => {
      await expect(selectOwnedRepos(env.DB, 999999)).resolves.toEqual({
        accounts: [],
      });
    });
  });

  describe('selectOwnedRepo', () => {
    it('returns the repo detail for a linked, live personal repo (happy path)', async () => {
      await upsertInstallation(env.DB, {
        id: 40,
        accountLogin: 'wnston',
        accountId: 4000,
        accountType: 'User',
      });
      await linkUser(40, 4000);
      await upsertRepos(env.DB, 40, [{ id: 400, owner: 'wnston', name: 'repo-a', private: true }]);
      await upsertStats(env.DB, fixtureStats(400, { collectedAt: '2026-07-22T00:00:00Z' }));

      await expect(selectOwnedRepo(env.DB, 400, 4000)).resolves.toEqual({
        id: 400,
        owner: 'wnston',
        name: 'repo-a',
        installationId: 40,
        collectedAt: '2026-07-22T00:00:00Z',
      });
    });

    it('returns the repo detail for a linked org installation’s repo (happy path — org installations)', async () => {
      await upsertInstallation(env.DB, {
        id: 47,
        accountLogin: 'acme',
        accountId: 7200,
        accountType: 'Organization',
      });
      await linkUser(47, 4701);
      await upsertRepos(env.DB, 47, [{ id: 470, owner: 'acme', name: 'repo-org', private: true }]);

      await expect(selectOwnedRepo(env.DB, 470, 4701)).resolves.toEqual({
        id: 470,
        owner: 'acme',
        name: 'repo-org',
        installationId: 47,
        collectedAt: null,
      });
    });

    it('returns null for an org installation’s repo when the caller has no link (permission boundary — unlinked-org reject)', async () => {
      await upsertInstallation(env.DB, {
        id: 48,
        accountLogin: 'acme',
        accountId: 7300,
        accountType: 'Organization',
      });
      // No link for githubUserId 4801.
      await upsertRepos(env.DB, 48, [{ id: 480, owner: 'acme', name: 'repo-org', private: true }]);

      await expect(selectOwnedRepo(env.DB, 480, 4801)).resolves.toBeNull();
    });

    it('returns null for a different tenant’s repo (permission boundary — cross-tenant)', async () => {
      await upsertInstallation(env.DB, {
        id: 41,
        accountLogin: 'wnston',
        accountId: 4100,
        accountType: 'User',
      });
      await linkUser(41, 4100);
      await upsertRepos(env.DB, 41, [{ id: 410, owner: 'wnston', name: 'repo-b', private: true }]);

      await expect(selectOwnedRepo(env.DB, 410, 999999)).resolves.toBeNull();
    });

    it('returns null for an unknown repo id (edge case)', async () => {
      await expect(selectOwnedRepo(env.DB, 999999, 4100)).resolves.toBeNull();
    });

    it('returns null for a removed repo', async () => {
      await upsertInstallation(env.DB, {
        id: 42,
        accountLogin: 'wnston',
        accountId: 4200,
        accountType: 'User',
      });
      await linkUser(42, 4200);
      await upsertRepos(env.DB, 42, [{ id: 420, owner: 'wnston', name: 'repo-c', private: true }]);
      await markRepoRemoved(env.DB, 420, '2026-07-22T00:00:00Z');

      await expect(selectOwnedRepo(env.DB, 420, 4200)).resolves.toBeNull();
    });

    it('returns null when the owning installation is suspended, even when linked', async () => {
      await upsertInstallation(env.DB, {
        id: 43,
        accountLogin: 'wnston',
        accountId: 4300,
        accountType: 'User',
      });
      await linkUser(43, 4300);
      await upsertRepos(env.DB, 43, [{ id: 430, owner: 'wnston', name: 'repo-d', private: true }]);
      await suspendInstallation(env.DB, 43, '2026-07-22T00:00:00Z');

      await expect(selectOwnedRepo(env.DB, 430, 4300)).resolves.toBeNull();
    });
  });

  describe('updateRepoIncluded', () => {
    it('toggles included 1 -> 0 -> 1 and returns 1 changed row each time (happy path)', async () => {
      await upsertInstallation(env.DB, {
        id: 50,
        accountLogin: 'wnston',
        accountId: 5000,
        accountType: 'User',
      });
      await linkUser(50, 5000);
      await upsertRepos(env.DB, 50, [{ id: 500, owner: 'wnston', name: 'repo-e', private: true }]);

      await expect(updateRepoIncluded(env.DB, 500, false, 5000)).resolves.toBe(1);
      let row = await env.DB.prepare('SELECT included FROM repos WHERE id = ?1')
        .bind(500)
        .first<{ included: number }>();
      expect(row?.included).toBe(0);

      await expect(updateRepoIncluded(env.DB, 500, true, 5000)).resolves.toBe(1);
      row = await env.DB.prepare('SELECT included FROM repos WHERE id = ?1')
        .bind(500)
        .first<{ included: number }>();
      expect(row?.included).toBe(1);
    });

    it('toggles a linked org installation’s repo (happy path — linked-org pass)', async () => {
      await upsertInstallation(env.DB, {
        id: 53,
        accountLogin: 'acme',
        accountId: 5300,
        accountType: 'Organization',
      });
      await linkUser(53, 5301);
      await upsertRepos(env.DB, 53, [{ id: 530, owner: 'acme', name: 'repo-org', private: true }]);

      await expect(updateRepoIncluded(env.DB, 530, false, 5301)).resolves.toBe(1);
      const row = await env.DB.prepare('SELECT included FROM repos WHERE id = ?1')
        .bind(530)
        .first<{ included: number }>();
      expect(row?.included).toBe(0);
    });

    it('returns 0 changes for an org installation’s repo when the caller has no link (permission boundary — unlinked-org reject)', async () => {
      await upsertInstallation(env.DB, {
        id: 54,
        accountLogin: 'acme',
        accountId: 5400,
        accountType: 'Organization',
      });
      // No link for githubUserId 5401.
      await upsertRepos(env.DB, 54, [{ id: 540, owner: 'acme', name: 'repo-org', private: true }]);

      await expect(updateRepoIncluded(env.DB, 540, false, 5401)).resolves.toBe(0);
      const row = await env.DB.prepare('SELECT included FROM repos WHERE id = ?1')
        .bind(540)
        .first<{ included: number }>();
      expect(row?.included).toBe(1);
    });

    it('returns 0 changes and does not mutate a different tenant’s repo (permission boundary — cross-tenant settings)', async () => {
      await upsertInstallation(env.DB, {
        id: 51,
        accountLogin: 'wnston',
        accountId: 5100,
        accountType: 'User',
      });
      await linkUser(51, 5100);
      await upsertRepos(env.DB, 51, [{ id: 510, owner: 'wnston', name: 'repo-f', private: true }]);

      await expect(updateRepoIncluded(env.DB, 510, false, 999999)).resolves.toBe(0);
      const row = await env.DB.prepare('SELECT included FROM repos WHERE id = ?1')
        .bind(510)
        .first<{ included: number }>();
      expect(row?.included).toBe(1);
    });

    it('returns 0 changes for an unknown repo id (edge case)', async () => {
      await expect(updateRepoIncluded(env.DB, 999999, true, 5100)).resolves.toBe(0);
    });

    it('returns 0 changes for a removed repo (does not resurrect it)', async () => {
      await upsertInstallation(env.DB, {
        id: 52,
        accountLogin: 'wnston',
        accountId: 5200,
        accountType: 'User',
      });
      await linkUser(52, 5200);
      await upsertRepos(env.DB, 52, [{ id: 520, owner: 'wnston', name: 'repo-g', private: true }]);
      await markRepoRemoved(env.DB, 520, '2026-07-22T00:00:00Z');

      await expect(updateRepoIncluded(env.DB, 520, false, 5200)).resolves.toBe(0);
    });
  });

  describe('countAttestedRepos', () => {
    it('counts only included, live, collected repos across the tenant (happy path)', async () => {
      await upsertInstallation(env.DB, {
        id: 60,
        accountLogin: 'wnston',
        accountId: 6000,
        accountType: 'User',
      });
      await linkUser(60, 6000);
      await upsertRepos(env.DB, 60, [
        { id: 600, owner: 'wnston', name: 'repo-a', private: true },
        { id: 601, owner: 'wnston', name: 'repo-b', private: true },
      ]);
      await upsertStats(env.DB, fixtureStats(600));
      await upsertStats(env.DB, fixtureStats(601));

      await expect(countAttestedRepos(env.DB, 6000)).resolves.toBe(2);
    });

    it('counts a linked org installation’s attested repos (happy path — linked-org pass)', async () => {
      await upsertInstallation(env.DB, {
        id: 65,
        accountLogin: 'acme',
        accountId: 6500,
        accountType: 'Organization',
      });
      await linkUser(65, 6501);
      await upsertRepos(env.DB, 65, [{ id: 650, owner: 'acme', name: 'repo-org', private: true }]);
      await upsertStats(env.DB, fixtureStats(650));

      await expect(countAttestedRepos(env.DB, 6501)).resolves.toBe(1);
    });

    it('excludes an org installation’s repos when the caller has no link (permission boundary — unlinked-org reject)', async () => {
      await upsertInstallation(env.DB, {
        id: 66,
        accountLogin: 'acme',
        accountId: 6600,
        accountType: 'Organization',
      });
      // No link for githubUserId 6601.
      await upsertRepos(env.DB, 66, [{ id: 660, owner: 'acme', name: 'repo-org', private: true }]);
      await upsertStats(env.DB, fixtureStats(660));

      await expect(countAttestedRepos(env.DB, 6601)).resolves.toBe(0);
    });

    it('excludes a repo with included = 0 even though it has a stats row', async () => {
      await upsertInstallation(env.DB, {
        id: 61,
        accountLogin: 'wnston',
        accountId: 6100,
        accountType: 'User',
      });
      await linkUser(61, 6100);
      await upsertRepos(env.DB, 61, [{ id: 610, owner: 'wnston', name: 'repo-c', private: true }]);
      await upsertStats(env.DB, fixtureStats(610));
      await env.DB.prepare('UPDATE repos SET included = 0 WHERE id = ?1').bind(610).run();

      await expect(countAttestedRepos(env.DB, 6100)).resolves.toBe(0);
    });

    it('excludes a removed repo even though it has a stats row', async () => {
      await upsertInstallation(env.DB, {
        id: 62,
        accountLogin: 'wnston',
        accountId: 6200,
        accountType: 'User',
      });
      await linkUser(62, 6200);
      await upsertRepos(env.DB, 62, [{ id: 620, owner: 'wnston', name: 'repo-d', private: true }]);
      await upsertStats(env.DB, fixtureStats(620));
      await markRepoRemoved(env.DB, 620, '2026-07-22T00:00:00Z');

      await expect(countAttestedRepos(env.DB, 6200)).resolves.toBe(0);
    });

    it('excludes every repo of a suspended installation even when linked and stats exist', async () => {
      await upsertInstallation(env.DB, {
        id: 63,
        accountLogin: 'wnston',
        accountId: 6300,
        accountType: 'User',
      });
      await linkUser(63, 6300);
      await upsertRepos(env.DB, 63, [{ id: 630, owner: 'wnston', name: 'repo-e', private: true }]);
      await upsertStats(env.DB, fixtureStats(630));
      await suspendInstallation(env.DB, 63, '2026-07-22T00:00:00Z');

      await expect(countAttestedRepos(env.DB, 6300)).resolves.toBe(0);
    });

    it('excludes an included, live repo with no stats row — not yet collected (edge case)', async () => {
      await upsertInstallation(env.DB, {
        id: 64,
        accountLogin: 'wnston',
        accountId: 6400,
        accountType: 'User',
      });
      await linkUser(64, 6400);
      await upsertRepos(env.DB, 64, [{ id: 640, owner: 'wnston', name: 'repo-f', private: true }]);

      await expect(countAttestedRepos(env.DB, 6400)).resolves.toBe(0);
    });

    it('returns 0 for an unlinked/unknown github user id (edge case)', async () => {
      await expect(countAttestedRepos(env.DB, 999999)).resolves.toBe(0);
    });
  });

  describe('replaceInstallationLinks', () => {
    async function linksFor(githubUserId: number): Promise<number[]> {
      const result = await env.DB.prepare(
        'SELECT installation_id FROM installation_users WHERE github_user_id = ?1 ORDER BY installation_id',
      )
        .bind(githubUserId)
        .all<{ installation_id: number }>();
      return result.results.map((row) => row.installation_id);
    }

    it('inserts fresh links for a user with none yet (happy path)', async () => {
      await replaceInstallationLinks(env.DB, 7000, [100, 101]);
      await expect(linksFor(7000)).resolves.toEqual([100, 101]);
    });

    it('reconciles to a smaller set, removing links no longer present (happy path — remove)', async () => {
      await replaceInstallationLinks(env.DB, 7001, [200, 201, 202]);
      await replaceInstallationLinks(env.DB, 7001, [201]);
      await expect(linksFor(7001)).resolves.toEqual([201]);
    });

    it('an empty array revokes every link for the user (edge case — revocation)', async () => {
      await replaceInstallationLinks(env.DB, 7002, [300, 301]);
      await replaceInstallationLinks(env.DB, 7002, []);
      await expect(linksFor(7002)).resolves.toEqual([]);
    });

    it('never touches a different user’s links (permission boundary — reconcile isolation)', async () => {
      await replaceInstallationLinks(env.DB, 7003, [400]);
      await replaceInstallationLinks(env.DB, 7004, [401]);
      await replaceInstallationLinks(env.DB, 7003, []);

      await expect(linksFor(7003)).resolves.toEqual([]);
      await expect(linksFor(7004)).resolves.toEqual([401]);
    });
  });
});
