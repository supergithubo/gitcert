import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createSessionCookie } from '../../src/lib/session';

const ORIGIN = 'https://gitcert.harborstack.app';

async function sessionCookieHeader(githubId: number, login: string): Promise<string> {
  const setCookie = await createSessionCookie({ githubId, login }, env.SESSION_SECRET);
  return setCookie.split(';')[0] ?? '';
}

function findSetCookie(response: Response, name: string): string | undefined {
  return response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
}

describe('GET /docs', () => {
  it('serves the cacheable signed-out variant for a cookie-less request (happy path)', async () => {
    const first = await SELF.fetch(`${ORIGIN}/docs`);
    expect(first.status).toBe(200);
    expect(first.headers.get('Content-Type')).toBe('text/html; charset=UTF-8');
    expect(first.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(first.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const html = await first.text();
    expect(html).not.toContain('data-account-menu');
    expect(html).toContain('Documentation');

    // Second cookie-less request is served straight from caches.default —
    // never re-renders, never touches D1 (architectures/edge-cache).
    const cache = caches.default;
    const cached = await cache.match(new Request(`${ORIGIN}/docs`));
    expect(cached).toBeDefined();
  });

  it('bypasses caches.default and renders the account menu for a valid session (happy path)', async () => {
    // Distinct query string, isolated from other tests' cache entries for
    // this same `edgeCache`-keyed-on-full-URL route — the route logic
    // itself is query-string-agnostic (cookie presence is the only branch).
    const url = `${ORIGIN}/docs?case=valid-session`;
    const response = await SELF.fetch(url, {
      headers: { Cookie: await sessionCookieHeader(9300, 'octocat') },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const html = await response.text();
    expect(html).toContain('data-account-menu');
    expect(html).toContain('@octocat');

    // A cookied request must never be served from, or populate, the shared
    // cache (architectures/edge-cache CRITICAL — no personalized leak).
    const cache = caches.default;
    const cached = await cache.match(new Request(url));
    expect(cached).toBeUndefined();
  });

  it('renders the signed-out variant with a clear-cookie for an invalid/garbage session (permission boundary — V-001 class)', async () => {
    const response = await SELF.fetch(`${ORIGIN}/docs`, {
      headers: { Cookie: 'gc_session=not.a-valid-session-cookie-value-at-all' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const html = await response.text();
    expect(html).not.toContain('data-account-menu');

    const sessionCookie = findSetCookie(response, 'gc_session');
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('Max-Age=0');
  });
});
