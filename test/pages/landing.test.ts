import { describe, expect, it } from 'vitest';
import { LandingPage, type LandingPageProps } from '../../src/pages/landing';

function render(auth: LandingPageProps['auth']): string {
  return String(LandingPage({ auth }));
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe('LandingPage (unauth)', () => {
  it('renders the signed-out CTA to /auth/login with its microcopy', () => {
    const html = render(null);
    expect(html).toContain('Connect GitHub');
    expect(html).toContain('href="/auth/login"');
    expect(html).toContain('read-only · installs in ~15s');
    expect(html).not.toContain('Go to Dashboard');
    expect(html).not.toContain('repos attested');
  });

  it('renders all 10 demo badges via the production templates', () => {
    const html = render(null);
    // 4 hero pills + 4 README flats + 2 inline pills.
    expect(count(html, 'role="img"')).toBe(10);
    // Production formatting, not the mock blobs: 1,247 (never 1.2k),
    // the issues slug label, relative last-commit.
    expect(html).toContain('1,247');
    expect(html).not.toContain('1.2k');
    expect(html).toContain('open issues');
    expect(html).toContain('1d ago');
    expect(html).toContain('Feb 2023');
    expect(html).toContain('TypeScript 81%');
    // Titles mirror the badge route's composition with the demo identity.
    expect(html).toContain(
      '<title>johndoe/client-platform: 1,247 commits (attested by gitcert)</title>',
    );
    expect(html).toContain(
      '<title>johndoe/client-platform: 1d ago last commit (attested by gitcert)</title>',
    );
    // theme=auto badges follow prefers-color-scheme inside the SVG.
    expect(html).toContain('prefers-color-scheme');
  });

  it('renders hero, steps, showcase cards, and trust strip copy', () => {
    const html = render(null);
    expect(html).toContain('Verified repository stats');
    expect(html).toContain('Your private work,');
    expect(html).toContain('independently attested.');
    expect(html).toContain('Install the app');
    expect(html).toContain('Pick repos');
    expect(html).toContain('Copy your badge');
    expect(html).toContain('In your README — public or private');
    expect(html).toContain('client-platform');
    expect(html).toContain('…and inline on your site');
    expect(html).toContain('John Doe');
    expect(html).toContain('read-only permissions');
    expect(html).toContain('open source collector');
    expect(html).toContain('signed responses');
  });

  it('keeps the demo identity anonymized and escapes the placeholder host', () => {
    const html = render(null);
    expect(html).toContain('johndoe/client-platform');
    expect(html).toContain('&lt;yoursite&gt;.io');
    expect(html).not.toContain('wnston');
  });

  it('has no attestation link in the inline-site links row (decision #4)', () => {
    const html = render(null);
    expect(html).not.toContain('attestation ↗');
  });
});

describe('LandingPage (auth)', () => {
  it('renders the signed-in CTA to /dashboard with the attested count', () => {
    const html = render({ attestedCount: 2 });
    expect(html).toContain('Go to Dashboard');
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('signed in · 2 repos attested');
    expect(html).not.toContain('Connect GitHub');
    expect(html).not.toContain('installs in ~15s');
  });

  it('pluralizes the microcopy at the edges', () => {
    expect(render({ attestedCount: 0 })).toContain('signed in · 0 repos attested');
    const one = render({ attestedCount: 1 });
    expect(one).toContain('signed in · 1 repo attested');
    expect(one).not.toContain('1 repos');
  });

  it('renders the same demo badges as the signed-out variant', () => {
    const html = render({ attestedCount: 2 });
    expect(count(html, 'role="img"')).toBe(10);
  });
});

describe('LandingPage copy rule (decision #5)', () => {
  it.each([null, { attestedCount: 2 }] as const)(
    'never claims metadata-only or source unreadability (auth: %o)',
    (auth) => {
      const html = render(auth);
      expect(html).not.toContain('metadata-only');
      expect(html).not.toContain('never read your source');
    },
  );

  it('links the trust copy to the open-source collector repo', () => {
    const html = render(null);
    expect(html).toContain('https://github.com/supergithubo/gitcert');
    expect(html).toContain('fully open source');
  });
});

describe('LandingPage brand', () => {
  it('uses the GitCert brand case and the page title', () => {
    const html = render(null);
    expect(html).toContain('GitCert');
    expect(html).toContain(
      '<title>GitCert — verified badges for private GitHub repositories</title>',
    );
  });
});
