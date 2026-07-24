import { SELF, env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { upsertInstallation, upsertRepos, upsertStats, type StatsInput } from '../../src/lib/db';
import { createStateCookie } from '../../src/lib/session';

const ORIGIN = 'https://gitcert.harborstack.app';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';
const GRAPHQL_URL = 'https://api.github.com/graphql';
const TOKEN_MINT_PATTERN = /\/app\/installations\/\d+\/access_tokens$/;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
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

/** Stubs `fetch` for a successful OAuth exchange + identity lookup, plus (optionally) the collector's boundary. */
function stubHappyOAuth(
  identity: { id: number; login: string },
  extra?: (url: string, init?: RequestInit) => Response | null,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === TOKEN_URL) {
        return jsonResponse({ access_token: 'gho_test_token' });
      }
      if (url === USER_URL) {
        return jsonResponse(identity);
      }
      const extraResponse = extra?.(url, init);
      if (extraResponse) return extraResponse;
      throw new Error(`unexpected fetch to ${url}`);
    }),
  );
}

describe('GET /auth/login', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sets the state cookie and redirects to the GitHub authorize URL (happy path)', async () => {
    const response = await SELF.fetch(`${ORIGIN}/auth/login`, { redirect: 'manual' });
    expect(response.status).toBe(302);

    const location = response.headers.get('Location');
    expect(location).not.toBeNull();
    const authorizeUrl = new URL(location!);
    expect(`${authorizeUrl.origin}${authorizeUrl.pathname}`).toBe(
      'https://github.com/login/oauth/authorize',
    );
    expect(authorizeUrl.searchParams.get('client_id')).toBe(env.GITHUB_CLIENT_ID);
    expect(authorizeUrl.searchParams.has('scope')).toBe(false);
    expect(authorizeUrl.searchParams.has('redirect_uri')).toBe(false);

    const stateCookie = findSetCookie(response, 'gc_oauth_state');
    expect(stateCookie).toBeDefined();
    expect(stateCookie).toContain('HttpOnly');
    expect(stateCookie).toContain('Secure');
    expect(stateCookie).toContain('SameSite=Lax');
    expect(stateCookie).toContain('Path=/');
    expect(stateCookie).toContain('Max-Age=600');

    const cookieValue = stateCookie!.split('=')[1]?.split(';')[0];
    expect(authorizeUrl.searchParams.get('state')).toBe(cookieValue);
  });
});

describe('GET /auth/callback', () => {
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

  it('renders the error page when GitHub reports an authorize error (error path)', async () => {
    const response = await SELF.fetch(`${ORIGIN}/auth/callback?error=access_denied`, {
      redirect: 'manual',
    });
    expect(response.status).toBe(400);
    expect(findSetCookie(response, 'gc_session')).toBeUndefined();
    expect(findSetCookie(response, 'gc_oauth_state')).toContain('Max-Age=0');
  });

  it('rejects a state mismatch, sets no session cookie (permission boundary — OAuth state mismatch)', async () => {
    const { nonce } = createStateCookie();
    const response = await SELF.fetch(`${ORIGIN}/auth/callback?code=abc&state=wrong-value`, {
      redirect: 'manual',
      headers: { Cookie: `gc_oauth_state=${nonce}` },
    });
    expect(response.status).toBe(400);
    expect(findSetCookie(response, 'gc_session')).toBeUndefined();
    expect(findSetCookie(response, 'gc_oauth_state')).toContain('Max-Age=0');
  });

  it('rejects a missing state cookie, sets no session cookie (permission boundary)', async () => {
    const response = await SELF.fetch(`${ORIGIN}/auth/callback?code=abc&state=whatever`, {
      redirect: 'manual',
    });
    expect(response.status).toBe(400);
    expect(findSetCookie(response, 'gc_session')).toBeUndefined();
  });

  it('rejects a missing state param and cookie with no install params (login shape, unchanged)', async () => {
    const response = await SELF.fetch(`${ORIGIN}/auth/callback?code=abc`, {
      redirect: 'manual',
    });
    expect(response.status).toBe(400);
    expect(findSetCookie(response, 'gc_session')).toBeUndefined();
  });

  it('install-initiated shape: no state param, no state cookie, but installation_id + setup_action present — bypasses the state check (happy path)', async () => {
    await upsertInstallation(env.DB, {
      id: 910,
      accountLogin: 'wnston',
      accountId: 42,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 910, [{ id: 9100, owner: 'wnston', name: 'repo-d', private: true }]);
    // Never collected -> stale -> kick expected.

    const graphqlCalls: string[] = [];
    stubHappyOAuth({ id: 42, login: 'wnston' }, (url) => {
      if (TOKEN_MINT_PATTERN.test(url)) {
        return jsonResponse({ token: 'ghs_test', expires_at: '2026-07-22T13:00:00Z' }, 201);
      }
      if (url === GRAPHQL_URL) {
        graphqlCalls.push(url);
        return jsonResponse({ data: { r0: null } });
      }
      return null;
    });

    // No state query param, no gc_oauth_state cookie sent — exactly what
    // GitHub's install-initiated redirect looks like in production.
    const response = await SELF.fetch(
      `${ORIGIN}/auth/callback?code=abc&installation_id=910&setup_action=install`,
      { redirect: 'manual' },
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/dashboard');

    const sessionCookie = findSetCookie(response, 'gc_session');
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('HttpOnly');

    // waitUntil promises run in background; give them a tick to settle.
    await vi.waitFor(() => expect(graphqlCalls.length).toBeGreaterThan(0));
  });

  it('install-initiated shape with a NOT-owned installation_id: session still created, no collect kicked, no token mint (permission boundary)', async () => {
    await upsertInstallation(env.DB, {
      id: 912,
      accountLogin: 'someone-else',
      accountId: 999,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 912, [
      { id: 9120, owner: 'someone-else', name: 'repo-e', private: true },
    ]);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === TOKEN_URL) return jsonResponse({ access_token: 'gho_test_token' });
      if (url === USER_URL) return jsonResponse({ id: 42, login: 'wnston' });
      if (TOKEN_MINT_PATTERN.test(url))
        throw new Error('must not mint a token for an unowned installation');
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    // No state param, no state cookie — the install-initiated shape.
    const response = await SELF.fetch(
      `${ORIGIN}/auth/callback?code=abc&installation_id=912&setup_action=install`,
      { redirect: 'manual' },
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/dashboard');
    expect(findSetCookie(response, 'gc_session')).toBeDefined();
  });

  it('install shape with a mismatched state param still fails even with installation_id + setup_action present (permission boundary — failed state is never bypassed)', async () => {
    const { nonce } = createStateCookie();
    const response = await SELF.fetch(
      `${ORIGIN}/auth/callback?code=abc&state=wrong-value&installation_id=911&setup_action=install`,
      { redirect: 'manual', headers: { Cookie: `gc_oauth_state=${nonce}` } },
    );
    expect(response.status).toBe(400);
    expect(findSetCookie(response, 'gc_session')).toBeUndefined();
    expect(findSetCookie(response, 'gc_oauth_state')).toContain('Max-Age=0');
  });

  it('install shape with state param ABSENT but gc_oauth_state cookie PRESENT still fails even with installation_id + setup_action present (permission boundary — bypass requires BOTH absent)', async () => {
    const { nonce } = createStateCookie();
    const response = await SELF.fetch(
      `${ORIGIN}/auth/callback?code=abc&installation_id=913&setup_action=install`,
      { redirect: 'manual', headers: { Cookie: `gc_oauth_state=${nonce}` } },
    );
    expect(response.status).toBe(400);
    expect(findSetCookie(response, 'gc_session')).toBeUndefined();
    expect(findSetCookie(response, 'gc_oauth_state')).toContain('Max-Age=0');
  });

  it('renders the error page when the code exchange fails (error path)', async () => {
    const { nonce } = createStateCookie();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bad request', { status: 400 })),
    );
    const response = await SELF.fetch(`${ORIGIN}/auth/callback?code=abc&state=${nonce}`, {
      redirect: 'manual',
      headers: { Cookie: `gc_oauth_state=${nonce}` },
    });
    expect(response.status).toBe(400);
    expect(findSetCookie(response, 'gc_session')).toBeUndefined();
  });

  it('renders the error page when the /user lookup fails (error path)', async () => {
    const { nonce } = createStateCookie();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url === TOKEN_URL) return jsonResponse({ access_token: 'gho_test_token' });
        if (url === USER_URL) return new Response('forbidden', { status: 403 });
        throw new Error(`unexpected fetch to ${url}`);
      }),
    );
    const response = await SELF.fetch(`${ORIGIN}/auth/callback?code=abc&state=${nonce}`, {
      redirect: 'manual',
      headers: { Cookie: `gc_oauth_state=${nonce}` },
    });
    expect(response.status).toBe(400);
    expect(findSetCookie(response, 'gc_session')).toBeUndefined();
  });

  it('sets the session cookie with exact attributes and redirects to /dashboard (happy path)', async () => {
    const { nonce } = createStateCookie();
    stubHappyOAuth({ id: 42, login: 'wnston' });

    const response = await SELF.fetch(`${ORIGIN}/auth/callback?code=abc&state=${nonce}`, {
      redirect: 'manual',
      headers: { Cookie: `gc_oauth_state=${nonce}` },
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/dashboard');

    const sessionCookie = findSetCookie(response, 'gc_session');
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('Secure');
    expect(sessionCookie).toContain('SameSite=Lax');
    expect(sessionCookie).toContain('Path=/');
    expect(sessionCookie).toContain('Max-Age=604800');

    expect(findSetCookie(response, 'gc_oauth_state')).toContain('Max-Age=0');
  });

  it('Decision 9: owned + stale installation_id + setup_action kicks a collect (happy path)', async () => {
    await upsertInstallation(env.DB, {
      id: 900,
      accountLogin: 'wnston',
      accountId: 42,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 900, [{ id: 9000, owner: 'wnston', name: 'repo-a', private: true }]);
    // Never collected -> stale -> kick expected.

    const { nonce } = createStateCookie();
    const graphqlCalls: string[] = [];
    stubHappyOAuth({ id: 42, login: 'wnston' }, (url) => {
      if (TOKEN_MINT_PATTERN.test(url)) {
        return jsonResponse({ token: 'ghs_test', expires_at: '2026-07-22T13:00:00Z' }, 201);
      }
      if (url === GRAPHQL_URL) {
        graphqlCalls.push(url);
        return jsonResponse({ data: { r0: null } });
      }
      return null;
    });

    const response = await SELF.fetch(
      `${ORIGIN}/auth/callback?code=abc&state=${nonce}&installation_id=900&setup_action=install`,
      { redirect: 'manual', headers: { Cookie: `gc_oauth_state=${nonce}` } },
    );
    expect(response.status).toBe(302);
    // waitUntil promises run in background; give them a tick to settle.
    await vi.waitFor(() => expect(graphqlCalls.length).toBeGreaterThan(0));
  });

  it('Decision 9: not-owned installation_id skips the collect kick, no token mint (permission boundary)', async () => {
    await upsertInstallation(env.DB, {
      id: 901,
      accountLogin: 'someone-else',
      accountId: 999,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 901, [
      { id: 9010, owner: 'someone-else', name: 'repo-b', private: true },
    ]);

    const { nonce } = createStateCookie();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === TOKEN_URL) return jsonResponse({ access_token: 'gho_test_token' });
      if (url === USER_URL) return jsonResponse({ id: 42, login: 'wnston' });
      if (TOKEN_MINT_PATTERN.test(url))
        throw new Error('must not mint a token for an unowned installation');
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await SELF.fetch(
      `${ORIGIN}/auth/callback?code=abc&state=${nonce}&installation_id=901&setup_action=install`,
      { redirect: 'manual', headers: { Cookie: `gc_oauth_state=${nonce}` } },
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/dashboard');
  });

  it('Decision 9: a fresh installation skips the redundant kick (edge case)', async () => {
    await upsertInstallation(env.DB, {
      id: 902,
      accountLogin: 'wnston',
      accountId: 42,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 902, [{ id: 9020, owner: 'wnston', name: 'repo-c', private: true }]);
    await upsertStats(env.DB, fixtureStats(9020, { collectedAt: new Date().toISOString() }));

    const { nonce } = createStateCookie();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === TOKEN_URL) return jsonResponse({ access_token: 'gho_test_token' });
      if (url === USER_URL) return jsonResponse({ id: 42, login: 'wnston' });
      throw new Error(`unexpected fetch to ${url} (no collect should be kicked)`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await SELF.fetch(
      `${ORIGIN}/auth/callback?code=abc&state=${nonce}&installation_id=902&setup_action=install`,
      { redirect: 'manual', headers: { Cookie: `gc_oauth_state=${nonce}` } },
    );
    expect(response.status).toBe(302);
  });
});

describe('POST /auth/logout', () => {
  it('clears the session cookie and redirects to the signed-out landing (happy path, no session required)', async () => {
    const response = await SELF.fetch(`${ORIGIN}/auth/logout`, {
      method: 'POST',
      redirect: 'manual',
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/?signed_out=1');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const sessionCookie = findSetCookie(response, 'gc_session');
    expect(sessionCookie).toContain('Max-Age=0');
  });
});
