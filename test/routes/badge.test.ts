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

const ORIGIN = 'https://gitcert.harborstack.app';
const NORMAL_CACHE_CONTROL = 'public, max-age=300, s-maxage=1800, stale-while-revalidate=86400';

function fixtureStats(repoId: number, overrides: Partial<StatsInput> = {}): StatsInput {
  return {
    repoId,
    collectedAt: '2026-07-22T00:00:00Z',
    commits: 1247,
    lastCommitAt: '2026-07-21T00:00:00Z',
    openIssues: 3,
    openPrs: 2,
    repoCreatedAt: '2020-01-01T00:00:00Z',
    firstCommitAt: '2020-01-01T00:00:00Z',
    sizeKb: 100,
    primaryLanguage: 'TypeScript',
    languagePct: 90,
    languages: [{ name: 'TypeScript', pct: 90 }],
    payloadJson: '{"cert_serial":"GC-000000"}',
    signature: 'sig',
    certSerial: 'GC-000000',
    ...overrides,
  };
}

describe('GET /b/:owner/:repo/:metric.svg', () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM stats'),
      env.DB.prepare('DELETE FROM repos'),
      env.DB.prepare('DELETE FROM installations'),
    ]);
  });

  it('renders a normal badge with the formatted value, Content-Type, cache headers and a strong ETag (happy path)', async () => {
    await upsertInstallation(env.DB, {
      id: 200,
      accountLogin: 'wnston',
      accountId: 1,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 200, [
      { id: 2000, owner: 'wnston', name: 'normal-repo', private: true },
    ]);
    await upsertStats(env.DB, fixtureStats(2000, { certSerial: 'GC-AAAAAA' }));

    const response = await SELF.fetch(`${ORIGIN}/b/wnston/normal-repo/commits.svg`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/svg+xml');
    expect(response.headers.get('Cache-Control')).toBe(NORMAL_CACHE_CONTROL);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('ETag')).toBe('"GC-AAAAAA:commits:flat:light"');

    const svg = await response.text();
    expect(svg).toContain('1,247');
    expect(svg).toContain('<title>wnston/normal-repo: 1,247 commits (attested by gitcert)</title>');
  });

  it('renders the stale variant past the 24h threshold, same cache policy as normal', async () => {
    await upsertInstallation(env.DB, {
      id: 201,
      accountLogin: 'wnston',
      accountId: 2,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 201, [
      { id: 2010, owner: 'wnston', name: 'stale-repo', private: true },
    ]);
    const oldCollectedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await upsertStats(env.DB, fixtureStats(2010, { collectedAt: oldCollectedAt }));

    const response = await SELF.fetch(`${ORIGIN}/b/wnston/stale-repo/commits.svg`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(NORMAL_CACHE_CONTROL);
    // Stale renders the hollow-seal variant, not the checked seal: distinguishable in the SVG markup.
    const svg = await response.text();
    expect(svg).toContain('1,247');
  });

  it('renders the collecting badge (60s cache, no ETag) for a live repo with no stats yet', async () => {
    await upsertInstallation(env.DB, {
      id: 202,
      accountLogin: 'wnston',
      accountId: 3,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 202, [
      { id: 2020, owner: 'wnston', name: 'collecting-repo', private: true },
    ]);

    const response = await SELF.fetch(`${ORIGIN}/b/wnston/collecting-repo/commits.svg`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/svg+xml');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
    expect(response.headers.get('ETag')).toBeNull();
    await expect(response.text()).resolves.toContain('collecting');
  });

  it('renders a byte-identical not-found badge for unknown/excluded/removed/suspended causes on the same owner/repo (no existence oracle, edge case)', async () => {
    const baseUrl = `${ORIGIN}/b/wnston/parity-repo/commits.svg`;
    // Each fetch carries a distinct, unused query param solely to bypass the
    // `caches.default` layer (keyed on the full URL) so this test actually
    // re-runs `selectPublicRepoState` per D1 state instead of serving a
    // cached response from the first fetch.

    // Cause 1: unknown — no repo row exists at all.
    const unknownResponse = await SELF.fetch(`${baseUrl}?cause=unknown`);
    const unknownBody = await unknownResponse.text();

    await upsertInstallation(env.DB, {
      id: 203,
      accountLogin: 'wnston',
      accountId: 4,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 203, [
      { id: 2030, owner: 'wnston', name: 'parity-repo', private: true },
    ]);

    // Cause 2: excluded (included = 0).
    await env.DB.prepare('UPDATE repos SET included = 0 WHERE id = ?1').bind(2030).run();
    const excludedResponse = await SELF.fetch(`${baseUrl}?cause=excluded`);
    const excludedBody = await excludedResponse.text();

    // Cause 3: removed.
    await env.DB.prepare('UPDATE repos SET included = 1 WHERE id = ?1').bind(2030).run();
    await markRepoRemoved(env.DB, 2030, '2026-07-22T00:00:00Z');
    const removedResponse = await SELF.fetch(`${baseUrl}?cause=removed`);
    const removedBody = await removedResponse.text();

    // Cause 4: owning installation suspended.
    await env.DB.prepare('UPDATE repos SET removed_at = NULL WHERE id = ?1').bind(2030).run();
    await suspendInstallation(env.DB, 203, '2026-07-22T00:00:00Z');
    const suspendedResponse = await SELF.fetch(`${baseUrl}?cause=suspended`);
    const suspendedBody = await suspendedResponse.text();

    for (const response of [
      unknownResponse,
      excludedResponse,
      removedResponse,
      suspendedResponse,
    ]) {
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('image/svg+xml');
      expect(response.headers.get('Cache-Control')).toBe(NORMAL_CACHE_CONTROL);
      expect(response.headers.get('ETag')).toBeNull();
    }
    expect(excludedBody).toBe(unknownBody);
    expect(removedBody).toBe(unknownBody);
    expect(suspendedBody).toBe(unknownBody);
  });

  it('falls back to the not-found badge for an unknown metric slug — never a broken image (edge case)', async () => {
    await upsertInstallation(env.DB, {
      id: 205,
      accountLogin: 'wnston',
      accountId: 6,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 205, [
      { id: 2050, owner: 'wnston', name: 'any-repo', private: true },
    ]);
    await upsertStats(env.DB, fixtureStats(2050));

    const response = await SELF.fetch(`${ORIGIN}/b/wnston/any-repo/bogus-metric.svg`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/svg+xml');
    await expect(response.text()).resolves.toContain('not found');
  });

  it('falls back to flat/light defaults for invalid style/theme query params', async () => {
    await upsertInstallation(env.DB, {
      id: 206,
      accountLogin: 'wnston',
      accountId: 7,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 206, [
      { id: 2060, owner: 'wnston', name: 'defaults-repo', private: true },
    ]);
    await upsertStats(env.DB, fixtureStats(2060, { certSerial: 'GC-BBBBBB' }));

    const response = await SELF.fetch(
      `${ORIGIN}/b/wnston/defaults-repo/commits.svg?style=bogus&theme=bogus`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('ETag')).toBe('"GC-BBBBBB:commits:flat:light"');
  });

  it('caps a label override at 64 chars and varies the ETag from the un-overridden badge', async () => {
    await upsertInstallation(env.DB, {
      id: 207,
      accountLogin: 'wnston',
      accountId: 8,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 207, [
      { id: 2070, owner: 'wnston', name: 'label-repo', private: true },
    ]);
    await upsertStats(env.DB, fixtureStats(2070, { certSerial: 'GC-CCCCCC' }));

    const withoutLabel = await SELF.fetch(`${ORIGIN}/b/wnston/label-repo/commits.svg`);
    const longLabel = 'x'.repeat(200);
    const withLabel = await SELF.fetch(
      `${ORIGIN}/b/wnston/label-repo/commits.svg?label=${longLabel}`,
    );

    expect(withLabel.headers.get('ETag')).not.toBe(withoutLabel.headers.get('ETag'));
    const svg = await withLabel.text();
    expect(svg).toContain('x'.repeat(64));
    expect(svg).not.toContain('x'.repeat(65));
  });

  it('returns 304 with no body when If-None-Match matches the ETag', async () => {
    await upsertInstallation(env.DB, {
      id: 208,
      accountLogin: 'wnston',
      accountId: 9,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 208, [
      { id: 2080, owner: 'wnston', name: 'etag-repo', private: true },
    ]);
    await upsertStats(env.DB, fixtureStats(2080, { certSerial: 'GC-DDDDDD' }));

    const first = await SELF.fetch(`${ORIGIN}/b/wnston/etag-repo/commits.svg`);
    const etag = first.headers.get('ETag');
    expect(etag).toBe('"GC-DDDDDD:commits:flat:light"');

    const second = await SELF.fetch(`${ORIGIN}/b/wnston/etag-repo/commits.svg`, {
      headers: { 'If-None-Match': etag! },
    });
    expect(second.status).toBe(304);
    await expect(second.text()).resolves.toBe('');
  });

  it('renders the pill style for a status metric (open issues) with a dark theme', async () => {
    await upsertInstallation(env.DB, {
      id: 209,
      accountLogin: 'wnston',
      accountId: 10,
      accountType: 'User',
    });
    await upsertRepos(env.DB, 209, [
      { id: 2090, owner: 'wnston', name: 'pill-repo', private: true },
    ]);
    await upsertStats(env.DB, fixtureStats(2090, { certSerial: 'GC-EEEEEE' }));

    const response = await SELF.fetch(
      `${ORIGIN}/b/wnston/pill-repo/issues.svg?style=pill&theme=dark`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('ETag')).toBe('"GC-EEEEEE:issues:pill:dark"');
    await expect(response.text()).resolves.toContain('3');
  });
});
