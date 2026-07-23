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
import { sign } from '../../src/lib/sign';

// Fixed synthetic test seed (same one used in test/lib/sign.test.ts) — not a
// real secret. Assigned directly onto the test env so these route tests
// don't depend on a local `.dev.vars` (there is none checked in — that file
// is per-developer and gitignored).
const TEST_SEED = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=';
const ORIGIN = 'https://gitcert.harborstack.app';

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
    payloadJson: '{"cert_serial":"GC-000000"}',
    signature: 'unset',
    certSerial: 'GC-000000',
    ...overrides,
  };
}

describe('GET /api/:owner/:repo.json, /pubkey, /healthz', () => {
  beforeEach(async () => {
    env.SIGNING_KEY = TEST_SEED;
    await env.DB.batch([
      env.DB.prepare('DELETE FROM stats'),
      env.DB.prepare('DELETE FROM repos'),
      env.DB.prepare('DELETE FROM installations'),
    ]);
  });

  describe('GET /api/:owner/:repo.json', () => {
    it('serves the stored payload_json byte-verbatim + a signature that verifies against /pubkey (happy path)', async () => {
      await upsertInstallation(env.DB, {
        id: 100,
        accountLogin: 'wnston',
        accountId: 1,
        accountType: 'User',
      });
      await upsertRepos(env.DB, 100, [
        { id: 1000, owner: 'wnston', name: 'ready-repo', private: true },
      ]);
      const payloadJson = '{"cert_serial":"GC-ABCDEF","stats":{"commits":10}}';
      const signature = await sign(payloadJson, TEST_SEED);
      await upsertStats(
        env.DB,
        fixtureStats(1000, { payloadJson, signature, certSerial: 'GC-ABCDEF' }),
      );

      const response = await SELF.fetch(`${ORIGIN}/api/wnston/ready-repo.json`);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/json');
      expect(response.headers.get('Cache-Control')).toBe(
        'public, max-age=300, s-maxage=1800, stale-while-revalidate=86400',
      );
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('ETag')).toBe('"GC-ABCDEF"');

      const body = await response.text();
      const expectedBody = `{"payload":${payloadJson},"signature":${JSON.stringify(signature)},"public_key_url":"https://gitcert.harborstack.app/pubkey"}`;
      expect(body).toBe(expectedBody);

      const pubkeyResponse = await SELF.fetch(`${ORIGIN}/pubkey`);
      const pubkeyBody = (await pubkeyResponse.json()) as { jwk: JsonWebKey };
      const publicKey = await crypto.subtle.importKey('jwk', pubkeyBody.jwk, 'Ed25519', true, [
        'verify',
      ]);
      const signatureBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
      await expect(
        crypto.subtle.verify(
          'Ed25519',
          publicKey,
          signatureBytes,
          new TextEncoder().encode(payloadJson),
        ),
      ).resolves.toBe(true);
    });

    it('returns 404 {"error":"collecting"} with a 60s Cache-Control for a live repo with no stats yet', async () => {
      await upsertInstallation(env.DB, {
        id: 101,
        accountLogin: 'wnston',
        accountId: 2,
        accountType: 'User',
      });
      await upsertRepos(env.DB, 101, [
        { id: 1010, owner: 'wnston', name: 'collecting-repo', private: true },
      ]);

      const response = await SELF.fetch(`${ORIGIN}/api/wnston/collecting-repo.json`);
      expect(response.status).toBe(404);
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      await expect(response.text()).resolves.toBe('{"error":"collecting"}');
    });

    it('returns a byte-identical 404 for unknown/excluded/removed/suspended repos (no existence oracle, edge case)', async () => {
      await upsertInstallation(env.DB, {
        id: 102,
        accountLogin: 'wnston',
        accountId: 3,
        accountType: 'User',
      });
      await upsertRepos(env.DB, 102, [
        { id: 1020, owner: 'wnston', name: 'excluded-repo', private: true },
        { id: 1021, owner: 'wnston', name: 'removed-repo', private: true },
      ]);
      await env.DB.prepare('UPDATE repos SET included = 0 WHERE id = ?1').bind(1020).run();
      await markRepoRemoved(env.DB, 1021, '2026-07-22T00:00:00Z');

      await upsertInstallation(env.DB, {
        id: 103,
        accountLogin: 'suspended-owner',
        accountId: 4,
        accountType: 'User',
      });
      await upsertRepos(env.DB, 103, [
        { id: 1030, owner: 'suspended-owner', name: 'suspended-repo', private: true },
      ]);
      await suspendInstallation(env.DB, 103, '2026-07-22T00:00:00Z');

      const urls = [
        `${ORIGIN}/api/nobody/nothing.json`,
        `${ORIGIN}/api/wnston/excluded-repo.json`,
        `${ORIGIN}/api/wnston/removed-repo.json`,
        `${ORIGIN}/api/suspended-owner/suspended-repo.json`,
      ];
      const responses = await Promise.all(urls.map((url) => SELF.fetch(url)));
      const bodies = await Promise.all(responses.map((r) => r.text()));

      for (const response of responses) {
        expect(response.status).toBe(404);
        // Same short TTL as `collecting` (not the `normal` tier) — a
        // toggle off→on must not leave a stale not-found cached beyond a
        // short client-side window (production defect: toggle-cache-purge).
        expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      }
      for (const body of bodies) {
        expect(body).toBe('{"error":"not_found"}');
      }
    });

    it('returns 304 with no body when If-None-Match matches the ETag', async () => {
      await upsertInstallation(env.DB, {
        id: 104,
        accountLogin: 'wnston',
        accountId: 5,
        accountType: 'User',
      });
      await upsertRepos(env.DB, 104, [
        { id: 1040, owner: 'wnston', name: 'etag-repo', private: true },
      ]);
      await upsertStats(env.DB, fixtureStats(1040, { certSerial: 'GC-111111' }));

      const first = await SELF.fetch(`${ORIGIN}/api/wnston/etag-repo.json`);
      const etag = first.headers.get('ETag');
      expect(etag).toBe('"GC-111111"');

      const second = await SELF.fetch(`${ORIGIN}/api/wnston/etag-repo.json`, {
        headers: { 'If-None-Match': etag! },
      });
      expect(second.status).toBe(304);
      await expect(second.text()).resolves.toBe('');
    });
  });

  describe('GET /pubkey', () => {
    it('derives the Ed25519 public key at request time with the expected shape and cache policy', async () => {
      const response = await SELF.fetch(`${ORIGIN}/pubkey`);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/json');
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400');
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');

      const body = (await response.json()) as {
        algorithm: string;
        public_key: string;
        jwk: { kty: string; crv: string; x: string };
      };
      expect(body.algorithm).toBe('Ed25519');
      expect(body.jwk).toMatchObject({ kty: 'OKP', crv: 'Ed25519' });
      const rawBytes = Uint8Array.from(atob(body.public_key), (c) => c.charCodeAt(0));
      expect(rawBytes.length).toBe(32);
    });
  });

  describe('GET /healthz', () => {
    it('reports null lag when no stats exist yet (edge case)', async () => {
      const response = await SELF.fetch(`${ORIGIN}/healthz`);
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      await expect(response.json()).resolves.toEqual({ status: 'ok', max_lag_seconds: null });
    });

    it('reports lag from the oldest included/live stats row, ignoring suspended installations', async () => {
      await upsertInstallation(env.DB, {
        id: 105,
        accountLogin: 'wnston',
        accountId: 6,
        accountType: 'User',
      });
      await upsertRepos(env.DB, 105, [
        { id: 1050, owner: 'wnston', name: 'lag-repo', private: true },
      ]);
      const collectedAt = new Date(Date.now() - 120_000).toISOString();
      await upsertStats(env.DB, fixtureStats(1050, { collectedAt }));

      const response = await SELF.fetch(`${ORIGIN}/healthz`);
      const body = (await response.json()) as { status: string; max_lag_seconds: number | null };
      expect(body.status).toBe('ok');
      expect(body.max_lag_seconds).toBeGreaterThanOrEqual(120);
      expect(body.max_lag_seconds).toBeLessThan(130);
    });
  });
});
