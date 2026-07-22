import { describe, expect, it } from 'vitest';
import { buildCanonicalPayload, type CanonicalPayloadInput } from '../../src/lib/payload';

function fixtureInput(): CanonicalPayloadInput {
  return {
    certSerial: 'GC-7F2A41',
    collectedAt: '2026-07-22T14:03:00Z',
    repo: 'wnston/client-platform',
    private: true,
    stats: {
      commits: 1247,
      createdAt: '2023-02-14T08:30:12Z',
      firstCommitAt: '2023-02-14T09:02:57Z',
      languagePct: 81.0,
      languages: [{ name: 'TypeScript', pct: 81.0 }],
      lastCommitAt: '2026-07-21T09:12:44Z',
      openIssues: 3,
      openPrs: 2,
      primaryLanguage: 'TypeScript',
      sizeKb: 48213,
    },
  };
}

describe('buildCanonicalPayload', () => {
  it('produces identical bytes for identical input (happy path)', () => {
    const first = buildCanonicalPayload(fixtureInput());
    const second = buildCanonicalPayload(fixtureInput());
    expect(first).toBe(second);
  });

  it('contains no whitespace', () => {
    const payload = buildCanonicalPayload(fixtureInput());
    expect(payload).not.toMatch(/[\n\r\t]| {2}/);
  });

  it('sorts top-level and nested keys alphabetically', () => {
    const payload = buildCanonicalPayload(fixtureInput());
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(
      ['cert_serial', 'collected_at', 'issuer', 'method', 'private', 'repo', 'stats', 'v'].sort(),
    );
    const stats = parsed.stats as Record<string, unknown>;
    expect(Object.keys(stats)).toEqual(Object.keys(stats).slice().sort());
  });

  it('contains the exact v1 field set and values from SPEC.md §7', () => {
    const payload = buildCanonicalPayload(fixtureInput());
    const parsed = JSON.parse(payload);
    expect(parsed).toEqual({
      cert_serial: 'GC-7F2A41',
      collected_at: '2026-07-22T14:03:00Z',
      issuer: 'gitcert.harborstack.app',
      method: 'github-app/read-only',
      repo: 'wnston/client-platform',
      private: true,
      stats: {
        commits: 1247,
        created_at: '2023-02-14T08:30:12Z',
        first_commit_at: '2023-02-14T09:02:57Z',
        language_pct: 81.0,
        languages: [{ name: 'TypeScript', pct: 81.0 }],
        last_commit_at: '2026-07-21T09:12:44Z',
        open_issues: 3,
        open_prs: 2,
        primary_language: 'TypeScript',
        size_kb: 48213,
      },
      v: 1,
    });
  });

  it('handles an empty repo (zero commits, null dates) without throwing (edge case)', () => {
    const input = fixtureInput();
    input.stats = {
      commits: 0,
      createdAt: '2026-01-01T00:00:00Z',
      firstCommitAt: null,
      languagePct: null,
      languages: [],
      lastCommitAt: null,
      openIssues: 0,
      openPrs: 0,
      primaryLanguage: null,
      sizeKb: 0,
    };
    const payload = buildCanonicalPayload(input);
    const parsed = JSON.parse(payload);
    expect(parsed.stats).toEqual({
      commits: 0,
      created_at: '2026-01-01T00:00:00Z',
      first_commit_at: null,
      language_pct: null,
      languages: [],
      last_commit_at: null,
      open_issues: 0,
      open_prs: 0,
      primary_language: null,
      size_kb: 0,
    });
  });
});
