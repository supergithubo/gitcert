import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { suspendInstallation, upsertInstallation, upsertRepos } from '../../src/lib/db';
import type { WaitUntilContext } from '../../src/lib/cache';
import { kickPostInstallCollect } from '../../src/lib/postInstall';

const TOKEN_URL_PATTERN = /\/app\/installations\/\d+\/access_tokens$/;
const GRAPHQL_URL = 'https://api.github.com/graphql';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Test-only shortcut for seeding an `installation_users` link row. */
async function linkUser(installationId: number, githubUserId: number): Promise<void> {
  await env.DB.prepare(
    'INSERT OR IGNORE INTO installation_users (installation_id, github_user_id) VALUES (?1, ?2)',
  )
    .bind(installationId, githubUserId)
    .run();
}

/**
 * `kickPostInstallCollect` calls `waitUntil` for its (fire-and-forget)
 * collector kick. This fake captures the promises so a test can await them
 * deterministically instead of racing a real `ExecutionContext`.
 */
function createWaitUntilContext(): { ctx: WaitUntilContext; settle: () => Promise<unknown> } {
  const promises: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil(promise: Promise<unknown>) {
        promises.push(promise);
      },
    },
    settle: () => Promise.all(promises),
  };
}

describe('kickPostInstallCollect', () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM installation_users'),
      env.DB.prepare('DELETE FROM stats'),
      env.DB.prepare('DELETE FROM repos'),
      env.DB.prepare('DELETE FROM installations'),
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fires a collector kick for a linked, stale organization installation (happy path — org installations)', async () => {
    await upsertInstallation(env.DB, {
      id: 700,
      accountLogin: 'acme',
      accountId: 7000,
      accountType: 'Organization',
    });
    await linkUser(700, 42);
    await upsertRepos(env.DB, 700, [{ id: 7000, owner: 'acme', name: 'repo-a', private: true }]);
    // Never collected -> stale -> kick expected.

    const graphqlCalls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (TOKEN_URL_PATTERN.test(url)) {
        return jsonResponse({ token: 'ghs_test', expires_at: '2026-07-22T13:00:00Z' }, 201);
      }
      if (url === GRAPHQL_URL) {
        graphqlCalls.push(url);
        return jsonResponse({ data: { r0: null } });
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { ctx, settle } = createWaitUntilContext();
    await kickPostInstallCollect(env, ctx, 42, 700);
    await settle();

    expect(graphqlCalls.length).toBeGreaterThan(0);
  });

  it('no-ops for an installation the caller has no link to (permission boundary — unlinked)', async () => {
    await upsertInstallation(env.DB, {
      id: 701,
      accountLogin: 'someone-else',
      accountId: 7010,
      accountType: 'User',
    });
    await linkUser(701, 999); // linked to a DIFFERENT github user.
    await upsertRepos(env.DB, 701, [
      { id: 7010, owner: 'someone-else', name: 'repo-b', private: true },
    ]);

    const fetchMock = vi.fn(async () => {
      throw new Error('must not call GitHub for an unowned installation');
    });
    vi.stubGlobal('fetch', fetchMock);

    const { ctx, settle } = createWaitUntilContext();
    await expect(kickPostInstallCollect(env, ctx, 42, 701)).resolves.toBeUndefined();
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no-ops for a suspended installation even when linked (edge case)', async () => {
    await upsertInstallation(env.DB, {
      id: 702,
      accountLogin: 'wnston',
      accountId: 7020,
      accountType: 'User',
    });
    await linkUser(702, 42);
    await upsertRepos(env.DB, 702, [{ id: 7020, owner: 'wnston', name: 'repo-c', private: true }]);
    await suspendInstallation(env.DB, 702, '2026-07-22T00:00:00Z');

    const fetchMock = vi.fn(async () => {
      throw new Error('must not call GitHub for a suspended installation');
    });
    vi.stubGlobal('fetch', fetchMock);

    const { ctx, settle } = createWaitUntilContext();
    await expect(kickPostInstallCollect(env, ctx, 42, 702)).resolves.toBeUndefined();
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no-ops for a linked installation that was already collected within the freshness window (edge case)', async () => {
    await upsertInstallation(env.DB, {
      id: 703,
      accountLogin: 'wnston',
      accountId: 7030,
      accountType: 'User',
    });
    await linkUser(703, 42);
    await upsertRepos(env.DB, 703, [{ id: 7030, owner: 'wnston', name: 'repo-d', private: true }]);
    await env.DB.prepare(
      `INSERT INTO stats (repo_id, collected_at, commits, open_issues, open_prs, payload_json, signature, cert_serial)
       VALUES (?1, ?2, 0, 0, 0, '{}', 'sig', 'GC-000000')`,
    )
      .bind(7030, new Date().toISOString())
      .run();

    const fetchMock = vi.fn(async () => {
      throw new Error('must not call GitHub for a repo collected within the freshness window');
    });
    vi.stubGlobal('fetch', fetchMock);

    const { ctx, settle } = createWaitUntilContext();
    await expect(kickPostInstallCollect(env, ctx, 42, 703)).resolves.toBeUndefined();
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
