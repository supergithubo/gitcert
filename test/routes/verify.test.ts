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
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=300');
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    }
    expect(excludedBody).toBe(unknownBody);
    expect(removedBody).toBe(unknownBody);
    expect(suspendedBody).toBe(unknownBody);
  });
});
