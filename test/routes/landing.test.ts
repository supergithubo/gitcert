import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  suspendInstallation,
  upsertInstallation,
  upsertRepos,
  upsertStats,
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

describe('GET /', () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM stats'),
      env.DB.prepare('DELETE FROM repos'),
      env.DB.prepare('DELETE FROM installations'),
    ]);
  });

  it('serves the cacheable unauth variant for a cookie-less request (happy path)', async () => {
    const first = await SELF.fetch(`${ORIGIN}/`);
    expect(first.status).toBe(200);
    expect(first.headers.get('Content-Type')).toBe('text/html; charset=UTF-8');
    expect(first.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(first.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const html = await first.text();
    expect(html).toContain('Connect GitHub');
    expect(html).toContain('href="/auth/login"');

    // Second cookie-less request is served straight from caches.default —
    // never re-renders, never touches D1 (architectures/edge-cache).
    const cache = caches.default;
    const cached = await cache.match(new Request(`${ORIGIN}/`));
    expect(cached).toBeDefined();
  });

  it('bypasses caches.default and renders the truthful attested count for a valid session (happy path)', async () => {
    await upsertInstallation(env.DB, {
      id: 900,
      accountLogin: 'wnston',
      accountId: 9000,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 900, [
      { id: 9001, owner: 'wnston', name: 'alpha', private: true },
      { id: 9002, owner: 'wnston', name: 'beta', private: true },
    ]);
    await upsertStats(env.DB, {
      repoId: 9001,
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
      certSerial: 'GC-000900',
    });
    await upsertStats(env.DB, {
      repoId: 9002,
      collectedAt: '2026-07-22T00:00:00Z',
      commits: 20,
      lastCommitAt: '2026-07-21T00:00:00Z',
      openIssues: 0,
      openPrs: 0,
      repoCreatedAt: '2020-01-01T00:00:00Z',
      firstCommitAt: '2020-01-01T00:00:00Z',
      sizeKb: 100,
      primaryLanguage: 'TypeScript',
      languagePct: 90,
      languages: [{ name: 'TypeScript', pct: 90 }],
      payloadJson: '{"v":1}',
      signature: 'sig',
      certSerial: 'GC-000901',
    });

    // Distinct query string, isolated from other tests' cache entries for
    // this same `edgeCache`-keyed-on-full-URL route — the route logic
    // itself is query-string-agnostic (cookie presence is the only branch).
    const url = `${ORIGIN}/?case=valid-session`;
    const response = await SELF.fetch(url, {
      headers: { Cookie: await sessionCookieHeader(9000, 'wnston') },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const html = await response.text();
    expect(html).toContain('Go to Dashboard');
    expect(html).toContain('signed in · 2 repos attested');

    // A cookied request must never be served from, or populate, the shared
    // cache (architectures/edge-cache CRITICAL — no personalized leak).
    const cache = caches.default;
    const cached = await cache.match(new Request(url));
    expect(cached).toBeUndefined();
  });

  it('renders the unauth variant with a clear-cookie for an invalid/garbage session (permission boundary)', async () => {
    const response = await SELF.fetch(`${ORIGIN}/`, {
      headers: { Cookie: 'gc_session=not.a-valid-session-cookie-value-at-all' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const html = await response.text();
    expect(html).toContain('Connect GitHub');
    expect(html).not.toContain('repos attested');

    // The forged claim renders only public content — this IS the
    // permission-boundary case (multi-tenant no-existence-oracle parity).
    const sessionCookie = findSetCookie(response, 'gc_session');
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('Max-Age=0');
  });

  it('renders 0 repos attested for a valid session with no attested repos (edge case)', async () => {
    await upsertInstallation(env.DB, {
      id: 901,
      accountLogin: 'nobody',
      accountId: 9100,
      accountType: 'User',
    });

    const response = await SELF.fetch(`${ORIGIN}/`, {
      headers: { Cookie: await sessionCookieHeader(9100, 'nobody') },
    });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('signed in · 0 repos attested');
  });

  it('excludes a suspended installation and an excluded/not-yet-collected repo from the truthful count (edge case)', async () => {
    await upsertInstallation(env.DB, {
      id: 902,
      accountLogin: 'wnston',
      accountId: 9200,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 902, [
      { id: 9201, owner: 'wnston', name: 'excluded-repo', private: true },
      { id: 9202, owner: 'wnston', name: 'not-yet-collected', private: true },
      { id: 9203, owner: 'wnston', name: 'attested-repo', private: true },
    ]);
    // excluded-repo: has stats but included = 0 — must not count.
    await upsertStats(env.DB, {
      repoId: 9201,
      collectedAt: '2026-07-22T00:00:00Z',
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
      certSerial: 'GC-000902',
    });
    await env.DB.prepare('UPDATE repos SET included = 0 WHERE id = ?1').bind(9201).run();
    // not-yet-collected: included, live, but no stats row — must not count.
    // attested-repo: included + live + stats row — counts.
    await upsertStats(env.DB, {
      repoId: 9203,
      collectedAt: '2026-07-22T00:00:00Z',
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
      certSerial: 'GC-000903',
    });

    const response = await SELF.fetch(`${ORIGIN}/`, {
      headers: { Cookie: await sessionCookieHeader(9200, 'wnston') },
    });
    const html = await response.text();
    expect(html).toContain('signed in · 1 repo attested');

    // Now suspend the installation entirely — even the one previously
    // attested repo must stop counting.
    await suspendInstallation(env.DB, 902, '2026-07-22T00:00:00Z');
    const suspendedResponse = await SELF.fetch(`${ORIGIN}/`, {
      headers: { Cookie: await sessionCookieHeader(9200, 'wnston') },
    });
    const suspendedHtml = await suspendedResponse.text();
    expect(suspendedHtml).toContain('signed in · 0 repos attested');
  });
});
