import { SELF, env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  suspendInstallation,
  upsertInstallation,
  upsertRepos,
  upsertStats,
  type StatsInput,
} from '../../src/lib/db';
import { createSessionCookie } from '../../src/lib/session';

const ORIGIN = 'https://gitcert.harborstack.app';
const TOKEN_MINT_PATTERN = /\/app\/installations\/\d+\/access_tokens$/;
const GRAPHQL_URL = 'https://api.github.com/graphql';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function sessionCookieHeader(githubId: number, login: string): Promise<string> {
  const setCookie = await createSessionCookie({ githubId, login }, env.SESSION_SECRET);
  const value = setCookie.split(';')[0];
  return value ?? '';
}

function findSetCookie(response: Response, name: string): string | undefined {
  return response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
}

function fixtureStats(repoId: number, overrides: Partial<StatsInput> = {}): StatsInput {
  return {
    repoId,
    collectedAt: '2020-01-01T00:00:00Z',
    commits: 1,
    lastCommitAt: null,
    openIssues: 0,
    openPrs: 0,
    repoCreatedAt: null,
    firstCommitAt: null,
    sizeKb: null,
    primaryLanguage: null,
    languagePct: null,
    languages: [],
    payloadJson: '{}',
    signature: 'sig',
    certSerial: 'GC-000000',
    ...overrides,
  };
}

/** Test-only shortcut for seeding an `installation_users` link row (org-installations spec — ownership now flows through this table, not `installations.account_id`). */
async function linkUser(installationId: number, githubUserId: number): Promise<void> {
  await env.DB.prepare(
    'INSERT OR IGNORE INTO installation_users (installation_id, github_user_id) VALUES (?1, ?2)',
  )
    .bind(installationId, githubUserId)
    .run();
}

describe('GET /dashboard', () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM installation_users'),
      env.DB.prepare('DELETE FROM stats'),
      env.DB.prepare('DELETE FROM repos'),
      env.DB.prepare('DELETE FROM installations'),
    ]);
  });

  it('redirects to /auth/login and clears the cookie when unauthenticated (permission boundary)', async () => {
    const response = await SELF.fetch(`${ORIGIN}/dashboard`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/auth/login');
    expect(response.headers.get('Cache-Control')).toBe('no-store');

    // V-001 regression: the clear-cookie must actually reach the client —
    // a handler that mixes c.header() with a raw returned Response drops it.
    const sessionCookie = findSetCookie(response, 'gc_session');
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('Max-Age=0');
  });

  it('treats a tampered session cookie as signed out (permission boundary — session forgery)', async () => {
    const cookie = await sessionCookieHeader(1, 'wnston');
    const [payload] = cookie.split('=')[1]!.split('.');
    const forged = `gc_session=${payload}.tamperedtamperedtamperedtamperedtamperedtamperedtampered`;
    const response = await SELF.fetch(`${ORIGIN}/dashboard`, {
      redirect: 'manual',
      headers: { Cookie: forged },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/auth/login');
  });

  it('treats an expired session cookie as signed out (permission boundary — session forgery)', async () => {
    const expired = await createSessionCookie(
      { githubId: 1, login: 'wnston' },
      env.SESSION_SECRET,
      () => new Date('2000-01-01T00:00:00Z'),
    );
    const response = await SELF.fetch(`${ORIGIN}/dashboard`, {
      redirect: 'manual',
      headers: { Cookie: expired.split(';')[0]! },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/auth/login');
  });

  it('renders only the session tenant’s repos and greys excluded rows (happy path)', async () => {
    await upsertInstallation(env.DB, {
      id: 1,
      accountLogin: 'wnston',
      accountId: 100,
      accountType: 'User',
    });
    await linkUser(1, 100);
    await upsertRepos(env.DB, 1, [
      { id: 10, owner: 'wnston', name: 'alpha', private: true },
      { id: 11, owner: 'wnston', name: 'beta', private: false },
    ]);
    await env.DB.prepare('UPDATE repos SET included = 0 WHERE id = ?1').bind(11).run();
    await upsertStats(env.DB, fixtureStats(10, { collectedAt: '2026-07-22T10:00:00Z' }));

    // A different tenant's repo must never render.
    await upsertInstallation(env.DB, {
      id: 2,
      accountLogin: 'someone-else',
      accountId: 200,
      accountType: 'User',
    });
    await linkUser(2, 200);
    await upsertRepos(env.DB, 2, [
      { id: 20, owner: 'someone-else', name: 'private-repo', private: true },
    ]);

    const response = await SELF.fetch(`${ORIGIN}/dashboard`, {
      headers: { Cookie: await sessionCookieHeader(100, 'wnston') },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const html = await response.text();
    expect(html).toContain('wnston');
    expect(html).toContain('alpha');
    expect(html).toContain('beta');
    expect(html).not.toContain('someone-else');
  });

  it('groups repos by installation account: `org` chip on orgs, none on personal (happy path)', async () => {
    await upsertInstallation(env.DB, {
      id: 1,
      accountLogin: 'wnston',
      accountId: 100,
      accountType: 'User',
    });
    await linkUser(1, 100);
    await upsertRepos(env.DB, 1, [{ id: 10, owner: 'wnston', name: 'alpha', private: true }]);
    await upsertStats(env.DB, fixtureStats(10, { collectedAt: new Date().toISOString() }));

    // An org installation the same user administers via installation_users.
    await upsertInstallation(env.DB, {
      id: 5,
      accountLogin: 'acme-labs',
      accountId: 500,
      accountType: 'Organization',
    });
    await linkUser(5, 100);
    await upsertRepos(env.DB, 5, [{ id: 50, owner: 'acme-labs', name: 'omega', private: true }]);
    await upsertStats(env.DB, fixtureStats(50, { collectedAt: new Date().toISOString() }));

    const html = await (
      await SELF.fetch(`${ORIGIN}/dashboard`, {
        headers: { Cookie: await sessionCookieHeader(100, 'wnston') },
      })
    ).text();

    expect(html).toContain('acme-labs');
    expect(html).toContain('omega');
    // Exactly one `org` chip: the org group has it, the personal group does not.
    expect(html.split('>org<').length - 1).toBe(1);
    const personal = html.slice(html.indexOf('data-repo-scroll'), html.indexOf('acme-labs'));
    expect(personal).not.toContain('>org<');
  });

  it('builds the per-account gear deep link from installation id and account type (happy path)', async () => {
    await upsertInstallation(env.DB, {
      id: 1,
      accountLogin: 'wnston',
      accountId: 100,
      accountType: 'User',
    });
    await linkUser(1, 100);
    await upsertRepos(env.DB, 1, [{ id: 10, owner: 'wnston', name: 'alpha', private: true }]);
    await upsertInstallation(env.DB, {
      id: 5,
      accountLogin: 'acme-labs',
      accountId: 500,
      accountType: 'Organization',
    });
    await linkUser(5, 100);
    await upsertRepos(env.DB, 5, [{ id: 50, owner: 'acme-labs', name: 'omega', private: true }]);

    const html = await (
      await SELF.fetch(`${ORIGIN}/dashboard`, {
        headers: { Cookie: await sessionCookieHeader(100, 'wnston') },
      })
    ).text();

    expect(html).toContain('href="https://github.com/settings/installations/1"');
    expect(html).toContain(
      'href="https://github.com/organizations/acme-labs/settings/installations/5"',
    );
    expect(html).toContain('title="Manage repos on GitHub"');
  });

  it('renders a stale repo in the stale token with a last-synced tooltip (edge case)', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    await upsertInstallation(env.DB, {
      id: 1,
      accountLogin: 'wnston',
      accountId: 100,
      accountType: 'User',
    });
    await linkUser(1, 100);
    await upsertRepos(env.DB, 1, [{ id: 10, owner: 'wnston', name: 'alpha', private: true }]);
    await upsertStats(env.DB, fixtureStats(10, { collectedAt: twoDaysAgo }));

    const html = await (
      await SELF.fetch(`${ORIGIN}/dashboard`, {
        headers: { Cookie: await sessionCookieHeader(100, 'wnston') },
      })
    ).text();

    expect(html).toContain('2d ago');
    expect(html).toContain('text-stale');
    expect(html).toContain('title="Last synced ');
    // The token, never a raw hex.
    expect(html).not.toContain('#b57614');
  });

  it('renders a repo with no stats row as collecting, copy disabled (edge case)', async () => {
    await upsertInstallation(env.DB, {
      id: 1,
      accountLogin: 'wnston',
      accountId: 100,
      accountType: 'User',
    });
    await linkUser(1, 100);
    await upsertRepos(env.DB, 1, [{ id: 10, owner: 'wnston', name: 'alpha', private: true }]);

    const html = await (
      await SELF.fetch(`${ORIGIN}/dashboard`, {
        headers: { Cookie: await sessionCookieHeader(100, 'wnston') },
      })
    ).text();

    expect(html).toContain('collecting…');
    // Included, so the enable toggle is on…
    expect(html).toContain('aria-pressed="true"');
    // …but there is nothing attested to copy yet.
    expect(html.split('cursor-not-allowed opacity-45').length - 1).toBe(4);
  });

  it('disables the copy affordance for an excluded repo (edge case)', async () => {
    await upsertInstallation(env.DB, {
      id: 1,
      accountLogin: 'wnston',
      accountId: 100,
      accountType: 'User',
    });
    await linkUser(1, 100);
    await upsertRepos(env.DB, 1, [{ id: 10, owner: 'wnston', name: 'alpha', private: true }]);
    await upsertStats(env.DB, fixtureStats(10, { collectedAt: new Date().toISOString() }));
    await env.DB.prepare('UPDATE repos SET included = 0 WHERE id = ?1').bind(10).run();

    const html = await (
      await SELF.fetch(`${ORIGIN}/dashboard`, {
        headers: { Cookie: await sessionCookieHeader(100, 'wnston') },
      })
    ).text();

    expect(html).toContain('excluded');
    expect(html).toContain('aria-pressed="false"');
    expect(html.split('cursor-not-allowed opacity-45').length - 1).toBe(4);
  });

  it('renders an installation with zero live repos as an empty group (edge case)', async () => {
    await upsertInstallation(env.DB, {
      id: 5,
      accountLogin: 'acme-labs',
      accountId: 500,
      accountType: 'Organization',
    });
    await linkUser(5, 100);

    const html = await (
      await SELF.fetch(`${ORIGIN}/dashboard`, {
        headers: { Cookie: await sessionCookieHeader(100, 'wnston') },
      })
    ).text();

    expect(html).toContain('acme-labs');
    expect(html).toContain('no repos selected');
    // The gear is the fix path, so it must still be reachable.
    expect(html).toContain(
      'href="https://github.com/organizations/acme-labs/settings/installations/5"',
    );
  });

  it('renders the empty state when the tenant has no repos (edge case)', async () => {
    const response = await SELF.fetch(`${ORIGIN}/dashboard`, {
      headers: { Cookie: await sessionCookieHeader(999999, 'nobody') },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('No installations yet');
  });
});

describe('GET /setup', () => {
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

  it('redirects to /auth/login when unauthenticated (permission boundary)', async () => {
    const response = await SELF.fetch(`${ORIGIN}/setup?installation_id=1`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/auth/login');
  });

  it('kicks a collect for an owned, stale installation then redirects to /dashboard (happy path)', async () => {
    await upsertInstallation(env.DB, {
      id: 5,
      accountLogin: 'wnston',
      accountId: 500,
      accountType: 'User',
    });
    await linkUser(5, 500);
    await upsertRepos(env.DB, 5, [{ id: 50, owner: 'wnston', name: 'repo-a', private: true }]);

    const graphqlCalls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (TOKEN_MINT_PATTERN.test(url)) {
          return jsonResponse({ token: 'ghs_test', expires_at: '2026-07-22T13:00:00Z' }, 201);
        }
        if (url === GRAPHQL_URL) {
          graphqlCalls.push(url);
          return jsonResponse({ data: { r0: null } });
        }
        throw new Error(`unexpected fetch to ${url}`);
      }),
    );

    const response = await SELF.fetch(`${ORIGIN}/setup?installation_id=5&setup_action=install`, {
      redirect: 'manual',
      headers: { Cookie: await sessionCookieHeader(500, 'wnston') },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/dashboard');
    await vi.waitFor(() => expect(graphqlCalls.length).toBeGreaterThan(0));
  });

  it('skips the kick for a not-owned installation_id, no token mint (permission boundary — cross-tenant)', async () => {
    await upsertInstallation(env.DB, {
      id: 6,
      accountLogin: 'someone-else',
      accountId: 600,
      accountType: 'User',
    });
    await linkUser(6, 600);
    await upsertRepos(env.DB, 6, [
      { id: 60, owner: 'someone-else', name: 'repo-b', private: true },
    ]);

    const fetchMock = vi.fn(async () => {
      throw new Error('must not call GitHub for a not-owned installation');
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await SELF.fetch(`${ORIGIN}/setup?installation_id=6&setup_action=install`, {
      redirect: 'manual',
      headers: { Cookie: await sessionCookieHeader(500, 'wnston') },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/dashboard');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips the kick for an unknown installation_id (edge case)', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('must not call GitHub for an unknown installation');
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await SELF.fetch(`${ORIGIN}/setup?installation_id=999999`, {
      redirect: 'manual',
      headers: { Cookie: await sessionCookieHeader(500, 'wnston') },
    });
    expect(response.status).toBe(302);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips the kick for an owned but suspended installation_id, no token mint (edge case)', async () => {
    await upsertInstallation(env.DB, {
      id: 7,
      accountLogin: 'wnston',
      accountId: 700,
      accountType: 'User',
    });
    await linkUser(7, 700);
    await upsertRepos(env.DB, 7, [{ id: 70, owner: 'wnston', name: 'repo-c', private: true }]);
    await suspendInstallation(env.DB, 7, '2026-07-22T00:00:00Z');

    const fetchMock = vi.fn(async () => {
      throw new Error('must not call GitHub for a suspended installation');
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await SELF.fetch(`${ORIGIN}/setup?installation_id=7&setup_action=install`, {
      redirect: 'manual',
      headers: { Cookie: await sessionCookieHeader(700, 'wnston') },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/dashboard');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('POST /repos/:id/settings', () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM installation_users'),
      env.DB.prepare('DELETE FROM stats'),
      env.DB.prepare('DELETE FROM repos'),
      env.DB.prepare('DELETE FROM installations'),
    ]);
  });

  it('rejects an unauthenticated request, body unchanged (permission boundary)', async () => {
    await upsertInstallation(env.DB, {
      id: 10,
      accountLogin: 'wnston',
      accountId: 1000,
      accountType: 'User',
    });
    await linkUser(10, 1000);
    await upsertRepos(env.DB, 10, [{ id: 100, owner: 'wnston', name: 'repo-a', private: true }]);

    const response = await SELF.fetch(`${ORIGIN}/repos/100/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ included: false }),
    });
    expect(response.status).toBe(401);

    const row = await env.DB.prepare('SELECT included FROM repos WHERE id = ?1')
      .bind(100)
      .first<{ included: number }>();
    expect(row?.included).toBe(1);
  });

  it('toggles included and returns the new value, purging the badge cache (happy path)', async () => {
    await upsertInstallation(env.DB, {
      id: 11,
      accountLogin: 'wnston',
      accountId: 1100,
      accountType: 'User',
    });
    await linkUser(11, 1100);
    await upsertRepos(env.DB, 11, [{ id: 110, owner: 'wnston', name: 'repo-b', private: true }]);

    const response = await SELF.fetch(`${ORIGIN}/repos/110/settings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Cookie: await sessionCookieHeader(1100, 'wnston'),
      },
      body: JSON.stringify({ included: false }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ ok: true, included: false });

    const row = await env.DB.prepare('SELECT included FROM repos WHERE id = ?1')
      .bind(110)
      .first<{ included: number }>();
    expect(row?.included).toBe(0);
  });

  it('purges cached verify and api responses for the repo on toggle, both directions (happy path — regression: toggle-cache-purge)', async () => {
    await upsertInstallation(env.DB, {
      id: 17,
      accountLogin: 'wnston',
      accountId: 1700,
      accountType: 'User',
    });
    await linkUser(17, 1700);
    await upsertRepos(env.DB, 17, [{ id: 170, owner: 'wnston', name: 'repo-g', private: true }]);

    const cache = caches.default;
    const verifyUrl = `${ORIGIN}/verify/wnston/repo-g`;
    const apiUrl = `${ORIGIN}/api/wnston/repo-g.json`;
    async function seedCache(): Promise<void> {
      await cache.put(
        verifyUrl,
        new Response('cached-verify', { headers: { 'Cache-Control': 'public, max-age=300' } }),
      );
      await cache.put(
        apiUrl,
        new Response('cached-api', { headers: { 'Cache-Control': 'public, max-age=300' } }),
      );
      await expect(cache.match(verifyUrl)).resolves.toBeDefined();
      await expect(cache.match(apiUrl)).resolves.toBeDefined();
    }

    // off -> on
    await seedCache();
    const offToOn = await SELF.fetch(`${ORIGIN}/repos/170/settings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Cookie: await sessionCookieHeader(1700, 'wnston'),
      },
      body: JSON.stringify({ included: true }),
    });
    expect(offToOn.status).toBe(200);
    await vi.waitFor(async () => {
      expect(await cache.match(verifyUrl)).toBeUndefined();
      expect(await cache.match(apiUrl)).toBeUndefined();
    });

    // on -> off
    await seedCache();
    const onToOff = await SELF.fetch(`${ORIGIN}/repos/170/settings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Cookie: await sessionCookieHeader(1700, 'wnston'),
      },
      body: JSON.stringify({ included: false }),
    });
    expect(onToOff.status).toBe(200);
    await vi.waitFor(async () => {
      expect(await cache.match(verifyUrl)).toBeUndefined();
      expect(await cache.match(apiUrl)).toBeUndefined();
    });
  });

  it('rejects malformed JSON with 400 (error path)', async () => {
    await upsertInstallation(env.DB, {
      id: 12,
      accountLogin: 'wnston',
      accountId: 1200,
      accountType: 'User',
    });
    await linkUser(12, 1200);
    await upsertRepos(env.DB, 12, [{ id: 120, owner: 'wnston', name: 'repo-c', private: true }]);

    const response = await SELF.fetch(`${ORIGIN}/repos/120/settings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Cookie: await sessionCookieHeader(1200, 'wnston'),
      },
      body: '{not valid json',
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'malformed_json' });
  });

  it('rejects an extra field with 422 (error path)', async () => {
    await upsertInstallation(env.DB, {
      id: 13,
      accountLogin: 'wnston',
      accountId: 1300,
      accountType: 'User',
    });
    await linkUser(13, 1300);
    await upsertRepos(env.DB, 13, [{ id: 130, owner: 'wnston', name: 'repo-d', private: true }]);

    const response = await SELF.fetch(`${ORIGIN}/repos/130/settings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Cookie: await sessionCookieHeader(1300, 'wnston'),
      },
      body: JSON.stringify({ included: false, extra: true }),
    });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_body' });
  });

  it('rejects a non-boolean included with 422 (error path)', async () => {
    await upsertInstallation(env.DB, {
      id: 14,
      accountLogin: 'wnston',
      accountId: 1400,
      accountType: 'User',
    });
    await linkUser(14, 1400);
    await upsertRepos(env.DB, 14, [{ id: 140, owner: 'wnston', name: 'repo-e', private: true }]);

    const response = await SELF.fetch(`${ORIGIN}/repos/140/settings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Cookie: await sessionCookieHeader(1400, 'wnston'),
      },
      body: JSON.stringify({ included: 'yes' }),
    });
    expect(response.status).toBe(422);
  });

  it('returns 404 (not 403) for a cross-tenant attempt, target unchanged (permission boundary — cross-tenant settings)', async () => {
    await upsertInstallation(env.DB, {
      id: 15,
      accountLogin: 'tenant-a',
      accountId: 1500,
      accountType: 'User',
    });
    await linkUser(15, 1500);
    await upsertRepos(env.DB, 15, [{ id: 150, owner: 'tenant-a', name: 'repo-f', private: true }]);
    await upsertInstallation(env.DB, {
      id: 16,
      accountLogin: 'tenant-b',
      accountId: 1600,
      accountType: 'User',
    });
    await linkUser(16, 1600);

    const response = await SELF.fetch(`${ORIGIN}/repos/150/settings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Cookie: await sessionCookieHeader(1600, 'tenant-b'),
      },
      body: JSON.stringify({ included: false }),
    });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'not_found' });

    const row = await env.DB.prepare('SELECT included FROM repos WHERE id = ?1')
      .bind(150)
      .first<{ included: number }>();
    expect(row?.included).toBe(1);
  });

  it('returns 404 for an unknown repo id (edge case)', async () => {
    const response = await SELF.fetch(`${ORIGIN}/repos/999999/settings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Cookie: await sessionCookieHeader(1600, 'tenant-b'),
      },
      body: JSON.stringify({ included: false }),
    });
    expect(response.status).toBe(404);
  });
});

describe('POST /repos/:id/refresh', () => {
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

  it('rejects an unauthenticated request (permission boundary)', async () => {
    const response = await SELF.fetch(`${ORIGIN}/repos/1/refresh`, { method: 'POST' });
    expect(response.status).toBe(401);
  });

  it('returns 404 (not 403) for a cross-tenant refresh attempt, no GitHub fetch (permission boundary)', async () => {
    await upsertInstallation(env.DB, {
      id: 20,
      accountLogin: 'tenant-a',
      accountId: 2000,
      accountType: 'User',
    });
    await linkUser(20, 2000);
    await upsertRepos(env.DB, 20, [{ id: 200, owner: 'tenant-a', name: 'repo-a', private: true }]);

    const fetchMock = vi.fn(async () => {
      throw new Error('must not call GitHub for a cross-tenant refresh');
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await SELF.fetch(`${ORIGIN}/repos/200/refresh`, {
      method: 'POST',
      headers: { Cookie: await sessionCookieHeader(999999, 'someone-else') },
    });
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rate-limits a refresh within 5 minutes of the last collect, no GitHub fetch (edge case)', async () => {
    await upsertInstallation(env.DB, {
      id: 21,
      accountLogin: 'wnston',
      accountId: 2100,
      accountType: 'User',
    });
    await linkUser(21, 2100);
    await upsertRepos(env.DB, 21, [{ id: 210, owner: 'wnston', name: 'repo-b', private: true }]);
    await upsertStats(env.DB, fixtureStats(210, { collectedAt: new Date().toISOString() }));

    const fetchMock = vi.fn(async () => {
      throw new Error('must not call GitHub while rate-limited');
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await SELF.fetch(`${ORIGIN}/repos/210/refresh`, {
      method: 'POST',
      headers: { Cookie: await sessionCookieHeader(2100, 'wnston') },
    });
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: 'rate_limited' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts and kicks the collector for the right installation, purging after (happy path)', async () => {
    await upsertInstallation(env.DB, {
      id: 22,
      accountLogin: 'wnston',
      accountId: 2200,
      accountType: 'User',
    });
    await linkUser(22, 2200);
    await upsertRepos(env.DB, 22, [{ id: 220, owner: 'wnston', name: 'repo-c', private: true }]);
    await upsertStats(env.DB, fixtureStats(220, { collectedAt: '2020-01-01T00:00:00Z' }));

    let mintedForInstallation: string | null = null;
    const graphqlCalls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (TOKEN_MINT_PATTERN.test(url)) {
          mintedForInstallation = url;
          return jsonResponse({ token: 'ghs_test', expires_at: '2026-07-22T13:00:00Z' }, 201);
        }
        if (url === GRAPHQL_URL) {
          graphqlCalls.push(url);
          return jsonResponse({ data: { r0: null } });
        }
        throw new Error(`unexpected fetch to ${url}`);
      }),
    );

    const response = await SELF.fetch(`${ORIGIN}/repos/220/refresh`, {
      method: 'POST',
      headers: { Cookie: await sessionCookieHeader(2200, 'wnston') },
    });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ ok: true });

    await vi.waitFor(() => expect(graphqlCalls.length).toBeGreaterThan(0));
    expect(mintedForInstallation).toContain('/22/');
  });

  it('purges cached verify and api responses for the repo once the collect completes (happy path — regression: toggle-cache-purge)', async () => {
    await upsertInstallation(env.DB, {
      id: 23,
      accountLogin: 'wnston',
      accountId: 2300,
      accountType: 'User',
    });
    await linkUser(23, 2300);
    await upsertRepos(env.DB, 23, [{ id: 230, owner: 'wnston', name: 'repo-d', private: true }]);
    await upsertStats(env.DB, fixtureStats(230, { collectedAt: '2020-01-01T00:00:00Z' }));

    const cache = caches.default;
    const verifyUrl = `${ORIGIN}/verify/wnston/repo-d`;
    const apiUrl = `${ORIGIN}/api/wnston/repo-d.json`;
    await cache.put(
      verifyUrl,
      new Response('cached-verify', { headers: { 'Cache-Control': 'public, max-age=300' } }),
    );
    await cache.put(
      apiUrl,
      new Response('cached-api', { headers: { 'Cache-Control': 'public, max-age=300' } }),
    );
    await expect(cache.match(verifyUrl)).resolves.toBeDefined();
    await expect(cache.match(apiUrl)).resolves.toBeDefined();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (TOKEN_MINT_PATTERN.test(url)) {
          return jsonResponse({ token: 'ghs_test', expires_at: '2026-07-22T13:00:00Z' }, 201);
        }
        if (url === GRAPHQL_URL) {
          return jsonResponse({ data: { r0: null } });
        }
        throw new Error(`unexpected fetch to ${url}`);
      }),
    );

    const response = await SELF.fetch(`${ORIGIN}/repos/230/refresh`, {
      method: 'POST',
      headers: { Cookie: await sessionCookieHeader(2300, 'wnston') },
    });
    expect(response.status).toBe(202);

    await vi.waitFor(async () => {
      expect(await cache.match(verifyUrl)).toBeUndefined();
      expect(await cache.match(apiUrl)).toBeUndefined();
    });
  });

  it('returns 404 for an unknown repo id (edge case)', async () => {
    const response = await SELF.fetch(`${ORIGIN}/repos/999999/refresh`, {
      method: 'POST',
      headers: { Cookie: await sessionCookieHeader(2200, 'wnston') },
    });
    expect(response.status).toBe(404);
  });
});
