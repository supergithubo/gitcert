import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  markRepoRemoved,
  suspendInstallation,
  upsertInstallation,
  upsertRepos,
  upsertStats,
  type StatsInput,
} from '../../src/lib/db';
import { createSessionCookie } from '../../src/lib/session';

const ORIGIN = 'https://gitcert.harborstack.app';

async function sessionCookieHeader(githubId: number, login: string): Promise<string> {
  const setCookie = await createSessionCookie({ githubId, login }, env.SESSION_SECRET);
  return setCookie.split(';')[0] ?? '';
}

function findSetCookie(response: Response, name: string): string | undefined {
  return response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
}

function fixtureStats(repoId: number, overrides: Partial<StatsInput> = {}): StatsInput {
  return {
    repoId,
    collectedAt: '2026-07-22T14:03:00Z',
    commits: 1247,
    lastCommitAt: '2026-07-21T09:12:44Z',
    openIssues: 3,
    openPrs: 2,
    repoCreatedAt: '2023-02-14T08:30:12Z',
    firstCommitAt: '2023-02-14T09:02:57Z',
    sizeKb: 48213,
    primaryLanguage: 'TypeScript',
    languagePct: 81,
    languages: [{ name: 'TypeScript', pct: 81 }],
    payloadJson: '{"cert_serial":"GC-7F2A41"}',
    signature: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAZZZZ',
    certSerial: 'GC-7F2A41',
    ...overrides,
  };
}

describe('GET /verify/:owner/:repo', () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM stats'),
      env.DB.prepare('DELETE FROM repos'),
      env.DB.prepare('DELETE FROM installations'),
    ]);
  });

  it('renders the certificate with serial, stats, and a truncated signature (happy path)', async () => {
    await upsertInstallation(env.DB, {
      id: 300,
      accountLogin: 'wnston',
      accountId: 1,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 300, [
      { id: 3000, owner: 'wnston', name: 'client-platform', private: true },
    ]);
    await upsertStats(env.DB, fixtureStats(3000));

    const response = await SELF.fetch(`${ORIGIN}/verify/wnston/client-platform`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=UTF-8');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');

    const html = await response.text();
    expect(html).toContain('GC-7F2A41');
    expect(html).toContain('1,247');
    expect(html).toContain('wnston');
    expect(html).toContain('client-platform');
    // Signature truncated to first-4…last-4, never rendered in full.
    expect(html).toContain('AAAA…ZZZZ');
    expect(html).not.toContain(fixtureStats(3000).signature);
  });

  it('escapes user-controlled owner/repo in the rendered HTML', async () => {
    await upsertInstallation(env.DB, {
      id: 301,
      accountLogin: 'evil',
      accountId: 2,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 301, [
      { id: 3010, owner: 'evil', name: '<script>alert(1)</script>', private: true },
    ]);
    await upsertStats(env.DB, fixtureStats(3010));

    const response = await SELF.fetch(
      `${ORIGIN}/verify/evil/${encodeURIComponent('<script>alert(1)</script>')}`,
    );
    const html = await response.text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders the collecting page with a 60s Cache-Control for a live repo with no stats yet', async () => {
    await upsertInstallation(env.DB, {
      id: 302,
      accountLogin: 'wnston',
      accountId: 3,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 302, [
      { id: 3020, owner: 'wnston', name: 'collecting-repo', private: true },
    ]);

    const response = await SELF.fetch(`${ORIGIN}/verify/wnston/collecting-repo`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
    await expect(response.text()).resolves.toContain('Attestation in progress');
  });

  it('renders a byte-identical 404 not-found page for unknown/excluded/removed/suspended causes (no existence oracle, edge case)', async () => {
    const baseUrl = `${ORIGIN}/verify/wnston/parity-repo`;

    const unknownResponse = await SELF.fetch(`${baseUrl}?cause=unknown`);
    const unknownBody = await unknownResponse.text();

    await upsertInstallation(env.DB, {
      id: 303,
      accountLogin: 'wnston',
      accountId: 4,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 303, [
      { id: 3030, owner: 'wnston', name: 'parity-repo', private: true },
    ]);

    await env.DB.prepare('UPDATE repos SET included = 0 WHERE id = ?1').bind(3030).run();
    const excludedResponse = await SELF.fetch(`${baseUrl}?cause=excluded`);
    const excludedBody = await excludedResponse.text();

    await env.DB.prepare('UPDATE repos SET included = 1 WHERE id = ?1').bind(3030).run();
    await markRepoRemoved(env.DB, 3030, '2026-07-22T00:00:00Z');
    const removedResponse = await SELF.fetch(`${baseUrl}?cause=removed`);
    const removedBody = await removedResponse.text();

    await env.DB.prepare('UPDATE repos SET removed_at = NULL WHERE id = ?1').bind(3030).run();
    await suspendInstallation(env.DB, 303, '2026-07-22T00:00:00Z');
    const suspendedResponse = await SELF.fetch(`${baseUrl}?cause=suspended`);
    const suspendedBody = await suspendedResponse.text();

    for (const response of [
      unknownResponse,
      excludedResponse,
      removedResponse,
      suspendedResponse,
    ]) {
      expect(response.status).toBe(404);
      // Same short TTL as `collecting` (not the `verify` tier) — a
      // toggle off→on must not leave a stale not-found cached beyond a
      // short client-side window (production defect: toggle-cache-purge).
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    }
    expect(excludedBody).toBe(unknownBody);
    expect(removedBody).toBe(unknownBody);
    expect(suspendedBody).toBe(unknownBody);
  });

  it('serves the cookie-less path unchanged: still cached, no back-link (spec overview §Step 6)', async () => {
    await upsertInstallation(env.DB, {
      id: 310,
      accountLogin: 'wnston',
      accountId: 10,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 310, [
      { id: 3100, owner: 'wnston', name: 'cookie-less-repo', private: true },
    ]);
    await upsertStats(env.DB, fixtureStats(3100));

    const url = `${ORIGIN}/verify/wnston/cookie-less-repo`;
    const response = await SELF.fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const html = await response.text();
    expect(html).not.toContain('← Back to dashboard');

    // Still populates the shared cache, exactly as before session-awareness.
    const cache = caches.default;
    const cached = await cache.match(new Request(url));
    expect(cached).toBeDefined();
  });

  it('bypasses caches.default and renders the back-link for a valid session (happy path)', async () => {
    await upsertInstallation(env.DB, {
      id: 311,
      accountLogin: 'wnston',
      accountId: 11,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 311, [
      { id: 3110, owner: 'wnston', name: 'signed-in-repo', private: true },
    ]);
    await upsertStats(env.DB, fixtureStats(3110));

    // Distinct query string, isolated from other tests' cache entries for
    // this same `edgeCache`-keyed-on-full-URL route.
    const url = `${ORIGIN}/verify/wnston/signed-in-repo?case=valid-session`;
    const response = await SELF.fetch(url, {
      headers: { Cookie: await sessionCookieHeader(9311, 'octocat') },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const html = await response.text();
    expect(html).toContain('← Back to dashboard');
    expect(html).toContain('href="/dashboard"');

    // A cookied request must never be served from, or populate, the shared
    // cache (architectures/edge-cache CRITICAL — no personalized leak).
    const cache = caches.default;
    const cached = await cache.match(new Request(url));
    expect(cached).toBeUndefined();
  });

  it('renders the signed-out markup with a clear-cookie for an invalid/garbage session (permission boundary — V-001 class)', async () => {
    await upsertInstallation(env.DB, {
      id: 312,
      accountLogin: 'wnston',
      accountId: 12,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 312, [
      { id: 3120, owner: 'wnston', name: 'invalid-session-repo', private: true },
    ]);
    await upsertStats(env.DB, fixtureStats(3120));

    const url = `${ORIGIN}/verify/wnston/invalid-session-repo?case=invalid-session`;
    const response = await SELF.fetch(url, {
      headers: { Cookie: 'gc_session=not.a-valid-session-cookie-value-at-all' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const html = await response.text();
    expect(html).not.toContain('← Back to dashboard');

    const sessionCookie = findSetCookie(response, 'gc_session');
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('Max-Age=0');

    const cache = caches.default;
    const cached = await cache.match(new Request(url));
    expect(cached).toBeUndefined();
  });

  it('renders a byte-identical signed-in not-found page across ALL FOUR hidden causes, back-link included (no existence oracle, edge case)', async () => {
    const baseUrl = `${ORIGIN}/verify/wnston/signed-in-parity-repo`;
    const cookieHeader = await sessionCookieHeader(9313, 'octocat');

    const unknownResponse = await SELF.fetch(`${baseUrl}?cause=unknown`, {
      headers: { Cookie: cookieHeader },
    });
    const unknownBody = await unknownResponse.text();

    await upsertInstallation(env.DB, {
      id: 313,
      accountLogin: 'wnston',
      accountId: 13,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 313, [
      { id: 3130, owner: 'wnston', name: 'signed-in-parity-repo', private: true },
    ]);

    await env.DB.prepare('UPDATE repos SET included = 0 WHERE id = ?1').bind(3130).run();
    const excludedResponse = await SELF.fetch(`${baseUrl}?cause=excluded`, {
      headers: { Cookie: cookieHeader },
    });
    const excludedBody = await excludedResponse.text();

    await env.DB.prepare('UPDATE repos SET included = 1 WHERE id = ?1').bind(3130).run();
    await markRepoRemoved(env.DB, 3130, '2026-07-22T00:00:00Z');
    const removedResponse = await SELF.fetch(`${baseUrl}?cause=removed`, {
      headers: { Cookie: cookieHeader },
    });
    const removedBody = await removedResponse.text();

    await env.DB.prepare('UPDATE repos SET removed_at = NULL WHERE id = ?1').bind(3130).run();
    await suspendInstallation(env.DB, 313, '2026-07-22T00:00:00Z');
    const suspendedResponse = await SELF.fetch(`${baseUrl}?cause=suspended`, {
      headers: { Cookie: cookieHeader },
    });
    const suspendedBody = await suspendedResponse.text();

    for (const response of [
      unknownResponse,
      excludedResponse,
      removedResponse,
      suspendedResponse,
    ]) {
      expect(response.status).toBe(404);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(unknownBody).toContain('← Back to dashboard');
    expect(excludedBody).toContain('← Back to dashboard');
    expect(removedBody).toContain('← Back to dashboard');
    expect(suspendedBody).toContain('← Back to dashboard');
    expect(excludedBody).toBe(unknownBody);
    expect(removedBody).toBe(unknownBody);
    expect(suspendedBody).toBe(unknownBody);
  });
});
