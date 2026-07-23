import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  markRepoRemoved,
  selectOldestCollectedAt,
  selectPublicRepoState,
  selectReposForInstallation,
  selectStaleInstallations,
  suspendInstallation,
  unsuspendInstallation,
  updateRepo,
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

describe('db.ts', () => {
  beforeEach(async () => {
    // Isolated per-test D1 (migrations applied in test/setup.ts) — clear
    // rows between tests instead of relying on isolation across files only.
    await env.DB.batch([
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
});
