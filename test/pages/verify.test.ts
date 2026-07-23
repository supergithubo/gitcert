import { describe, expect, it } from 'vitest';
import type { PublicStats } from '../../src/lib/types';
import {
  VerifyCollectingPage,
  VerifyNotFoundPage,
  VerifyPage,
  type VerifyProps,
} from '../../src/pages/verify';

function fixtureStats(overrides: Partial<PublicStats> = {}): PublicStats {
  return {
    commits: 1247,
    lastCommitAt: '2026-07-21T09:12:44Z',
    openIssues: 3,
    openPrs: 2,
    repoCreatedAt: '2023-02-14T08:30:12Z',
    firstCommitAt: '2023-02-14T09:02:57Z',
    sizeKb: 48_128,
    primaryLanguage: 'TypeScript',
    languagePct: 81.2,
    languages: [{ name: 'TypeScript', pct: 81.2 }],
    ...overrides,
  };
}

function fixtureProps(overrides: Partial<VerifyProps> = {}): VerifyProps {
  return {
    owner: 'wnston',
    repo: 'client-platform',
    isPrivate: true,
    certSerial: 'GC-7F2A41',
    collectedAt: '2026-07-22T14:03:00Z',
    signature: 'a41fBASE64SIGNATUREBYTES9c2e',
    stats: fixtureStats(),
    ...overrides,
  };
}

function render(node: unknown): string {
  return String(node);
}

describe('VerifyPage', () => {
  it('renders the certificate header, serial, and repository identity', () => {
    const html = render(VerifyPage(fixtureProps()));
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('GitCert');
    expect(html).toContain('# GC-7F2A41');
    expect(html).toContain('Attestation of Repository Activity');
    expect(html).toContain('wnston/client-platform');
    expect(html).toContain('(private)');
    expect(html).toContain('@wnston');
    expect(html).toContain('gitcert.harborstack.app/verify/wnston/client-platform');
  });

  it('renders all 8 stats rows with SPEC §8 certificate formatting', () => {
    const html = render(VerifyPage(fixtureProps()));
    expect(html).toContain('1,247');
    expect(html).toContain('on default branch');
    expect(html).toContain('Jul 21, 2026');
    expect(html).toContain('Feb 14, 2023');
    expect(html).toContain('open issues');
    expect(html).toContain('open PRs');
    expect(html).toContain('TypeScript');
    expect(html).toContain('81%');
    expect(html).toContain('47 MB');
  });

  it('renders attested timestamp, method, and shortened signature', () => {
    const html = render(VerifyPage(fixtureProps()));
    expect(html).toContain('Jul 22 2026, 14:03 UTC');
    expect(html).toContain('GitHub App · read-only');
    expect(html).toContain('a41f…9c2e');
    expect(html).not.toContain('a41fBASE64SIGNATUREBYTES9c2e');
  });

  it('marks public repos as public', () => {
    const html = render(VerifyPage(fixtureProps({ isPrivate: false })));
    expect(html).toContain('(public)');
  });

  it('includes the inline verify script and the canonical seal', () => {
    const html = render(VerifyPage(fixtureProps()));
    expect(html).toContain('gc-verify-btn');
    expect(html).toContain("importKey('raw'");
    expect(html).toContain('m9 12 2 2 4-4');
    expect(html).toContain('signature valid');
  });

  it('escapes user-controlled strings', () => {
    const html = render(
      VerifyPage(
        fixtureProps({
          owner: '<script>alert(1)</script>',
          repo: 'a&b"c',
          stats: fixtureStats({ primaryLanguage: '<img src=x>' }),
        }),
      ),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x>');
  });

  it('degrades gracefully when nullable stats are missing', () => {
    const html = render(
      VerifyPage(
        fixtureProps({
          stats: fixtureStats({
            lastCommitAt: null,
            firstCommitAt: null,
            sizeKb: null,
            primaryLanguage: null,
            languagePct: null,
          }),
        }),
      ),
    );
    expect(html).toContain('—');
    expect(html).not.toContain('null');
  });
});

describe('VerifyCollectingPage', () => {
  it('renders the collecting badge and progress copy', () => {
    const html = render(VerifyCollectingPage({ owner: 'wnston', repo: 'some-repo' }));
    expect(html).toContain('collecting…');
    expect(html).toContain('gcpulse');
    expect(html).toContain('Attestation in progress — first collection running.');
    expect(html).toContain('check back shortly');
    expect(html).toContain('gitcert.harborstack.app/verify/wnston/some-repo');
  });

  it('carries no stats, serial, or verify script', () => {
    const html = render(VerifyCollectingPage({ owner: 'wnston', repo: 'some-repo' }));
    expect(html).not.toContain('# GC-');
    expect(html).not.toContain('gc-verify-btn');
  });

  it('escapes user-controlled strings', () => {
    const html = render(VerifyCollectingPage({ owner: '<b>x</b>', repo: 'r' }));
    expect(html).not.toContain('<b>x</b>');
  });
});

describe('VerifyNotFoundPage', () => {
  it('renders the cause-blind empty state', () => {
    const html = render(VerifyNotFoundPage({ owner: 'wnston', repo: 'some-repo' }));
    expect(html).toContain('No attestation found for wnston/some-repo.');
    expect(html).toContain('stroke-dasharray="2.6 4.2"');
    expect(html).toContain('Connect GitHub');
  });

  it('carries no stats, serial, or verify script', () => {
    const html = render(VerifyNotFoundPage({ owner: 'wnston', repo: 'some-repo' }));
    expect(html).not.toContain('# GC-');
    expect(html).not.toContain('gc-verify-btn');
  });

  it('escapes user-controlled strings', () => {
    const html = render(VerifyNotFoundPage({ owner: 'o', repo: '"><svg onload=x>' }));
    expect(html).not.toContain('"><svg onload=x>');
  });
});
