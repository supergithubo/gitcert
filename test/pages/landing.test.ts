import { describe, expect, it } from 'vitest';
import { LandingPage, type LandingPageProps } from '../../src/pages/landing';

function render(auth: LandingPageProps['auth'], signedOut?: boolean): string {
  return String(LandingPage({ auth, signedOut }));
}

/** Signed-in auth fixture — handle feeds the shared account menu. */
function authed(attestedCount: number): LandingPageProps['auth'] {
  return { attestedCount, handle: 'octocat' };
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe('LandingPage (unauth)', () => {
  it('renders the signed-out CTA to /auth/login relabelled "Install App"', () => {
    const html = render(null);
    // Decision 3-REV: the label is "Install App"; the install flow is unchanged.
    expect(html).toContain('Install App');
    expect(html).toContain('href="/auth/login"');
    expect(html).not.toContain('Connect GitHub');
    // The old microcopy is gone, replaced by the sample-cert link (below).
    expect(html).not.toContain('read-only · installs in ~15s');
    expect(html).not.toContain('Go to Dashboard');
    expect(html).not.toContain('repos attested');
  });

  it('replaces the CTA microcopy with an accent "View sample certificate ↗" link (Decision A)', () => {
    const html = render(null);
    const at = html.indexOf('View sample certificate ↗');
    expect(at).toBeGreaterThan(-1);
    const open = html.slice(html.lastIndexOf('<a', at), html.indexOf('>', at));
    // Same-origin link to a real, publicly-attested certificate.
    expect(open).toContain('href="/verify/supergithubo/wnston.dev"');
    // Accent is permitted here by decision 10c ("the mock renders it accent").
    expect(open).toContain('text-accent');
    expect(open).toContain('target="_blank"');
    expect(open).toContain('rel="noopener"');
  });

  it('renders the refreshed hero blurb', () => {
    const html = render(null);
    expect(html).toContain(
      'Help clients and recruiters trust your experience with cryptographically verifiable',
    );
    expect(html).toContain('without exposing your source code');
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

  it('keeps every inline badge clipPath id unique across the document', () => {
    // The README card inlines four flat badges in ONE document — a shared id
    // would make url(#…) resolve to the first badge's clip and truncate the rest.
    const html = render(null);
    const ids = [...html.matchAll(/<clipPath id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(4);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the demo identity anonymized and escapes the placeholder host', () => {
    const html = render(null);
    expect(html).toContain('johndoe/client-platform');
    expect(html).toContain('&lt;yoursite&gt;.io');
    // Anonymization covers the MOCK DATA only. Two real-identity references
    // are intentional and allowed: the footer's "Built by wnston.dev" credit,
    // and the "View sample certificate ↗" target (Decision A — a real, public
    // certificate at /verify/supergithubo/wnston.dev). Remove the sample-cert
    // href, then assert nothing else before the footer leaks the owner.
    const beforeFooter = html
      .slice(0, html.indexOf('<footer'))
      .replace('/verify/supergithubo/wnston.dev', '');
    expect(beforeFooter).not.toContain('wnston');
  });

  it('has no attestation link in the inline-site links row (decision #4)', () => {
    const html = render(null);
    expect(html).not.toContain('attestation ↗');
  });
});

describe('LandingPage (auth)', () => {
  it('renders the signed-in CTA to /dashboard with the attested count', () => {
    const html = render(authed(2));
    expect(html).toContain('Go to Dashboard');
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('signed in · 2 repos attested');
    expect(html).not.toContain('Install App');
    expect(html).not.toContain('installs in ~15s');
  });

  it('pluralizes the microcopy at the edges', () => {
    expect(render(authed(0))).toContain('signed in · 0 repos attested');
    const one = render(authed(1));
    expect(one).toContain('signed in · 1 repo attested');
    expect(one).not.toContain('1 repos');
  });

  it('threads the handle into the shared account menu', () => {
    const html = render(authed(2));
    expect(html).toContain('data-account-menu');
    expect(html).toContain('@octocat');
    expect(html).toContain('signed in via GitHub');
  });

  it('renders the same demo badges as the signed-out variant', () => {
    const html = render(authed(2));
    expect(count(html, 'role="img"')).toBe(10);
  });
});

describe('LandingPage signed-out band (Decision B)', () => {
  it('renders only when the signedOut flag is set', () => {
    expect(render(null)).not.toContain('badges keep resolving');
    const html = render(null, true);
    expect(html).toContain('Signed out of GitCert. Your repo access is untouched');
    expect(html).toContain('badges keep resolving');
  });

  it('dismisses via a plain link back to / (no JS, no cache poisoning)', () => {
    const html = render(null, true);
    const at = html.indexOf('aria-label="dismiss"');
    expect(at).toBeGreaterThan(-1);
    const open = html.slice(html.lastIndexOf('<a', at), html.indexOf('>', at));
    expect(open).toContain('href="/"');
  });
});

/**
 * Same decision #5 honesty guard as docs.test.ts BANNED_COPY — kept in sync.
 * Catches the CLASS of metadata-only / source-unreadability claims, not just
 * the exact old strings. Landing copy is compliant: read-only = never writes,
 * "keeps only aggregates" is the storage frame, and the trust strip says
 * "audit exactly which fields are read".
 */
const BANNED_COPY = [
  'metadata-only',
  'metadata only',
  'never read your source',
  'can never read',
  "can't read your source",
  'cannot read your source',
  'never your source',
  'counts and dates only',
  'only counts and',
  'reads only',
  'sees only',
  'only sees',
] as const;

describe('LandingPage copy rule (decision #5)', () => {
  it.each([null, authed(2)] as const)(
    'never claims metadata-only or source unreadability (auth: %o)',
    (auth) => {
      const html = render(auth).toLowerCase();
      for (const phrase of BANNED_COPY) {
        expect(html, `decision #5 violation: "${phrase}"`).not.toContain(phrase);
      }
    },
  );

  it('links the trust copy to the open-source collector repo', () => {
    const html = render(null);
    expect(html).toContain('https://github.com/supergithubo/gitcert');
    expect(html).toContain('fully open source');
  });
});

describe('LandingPage accent discipline (mock authority)', () => {
  it('renders both CTAs as ink buttons with paper text, never accent', () => {
    for (const auth of [null, authed(2)] as const) {
      const html = render(auth);
      // First match is now the nav wordmark link (href="/", ink text, not a
      // button); the hero CTA is the last internal data-nav anchor on the page.
      const anchors = [
        ...html.matchAll(/<a data-nav="true" href="\/(?:auth\/login|dashboard)?" class="([^"]+)"/g),
      ].map((m) => m[1]);
      expect(anchors.length).toBeGreaterThanOrEqual(2);
      for (const cls of anchors) expect(cls).not.toContain('accent');
      const cta = anchors[anchors.length - 1];
      expect(cta).toContain('bg-ink');
      expect(cta).toContain('text-paper');
    }
  });

  it('styles trust-strip anchors with the muted reference treatment', () => {
    const html = render(null);
    const trustLinks = [
      ...html.matchAll(/<a href="https:\/\/github\.com\/supergithubo\/gitcert" class="([^"]+)"/g),
    ].map((m) => m[1]);
    expect(trustLinks).toHaveLength(2);
    for (const cls of trustLinks) {
      expect(cls).toContain('text-soft');
      expect(cls).toContain('underline');
      expect(cls).toContain('hover:text-accent');
    }
  });
});

describe('Layout theme toggle (restored from the mocks)', () => {
  it('inlines the no-flash theme-init script in <head> before the stylesheet', () => {
    const html = render(null);
    const script = html.indexOf("localStorage.getItem('gc-theme')");
    const stylesheet = html.indexOf('href="/styles.css"');
    expect(script).toBeGreaterThan(-1);
    expect(stylesheet).toBeGreaterThan(-1);
    expect(script).toBeLessThan(stylesheet);
  });

  it('renders the toggle button with both mock glyphs, far right of the nav', () => {
    const html = render(null);
    expect(html).toContain('id="gc-theme-toggle"');
    expect(html).toContain('aria-label="toggle theme"');
    expect(html).toContain('data-theme-icon="sun"');
    expect(html).toContain('data-theme-icon="moon"');
    // Mock moon path; the toggle sits far right — after the Documentation
    // nav link (the header GitHub link moved to the footer this cycle).
    expect(html).toContain('M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z');
    const header = html.slice(0, html.indexOf('<div class="flex-1">'));
    expect(header.indexOf('>Documentation</a>')).toBeLessThan(header.indexOf('gc-theme-toggle'));
  });

  it('wires the toggle to data-gc-theme on <html> with localStorage persistence', () => {
    const html = render(null);
    expect(html).toContain("setAttribute('data-gc-theme', next)");
    expect(html).toContain("localStorage.setItem('gc-theme', next)");
    // Respects prefers-color-scheme when no explicit theme is set.
    expect(html).toContain("matchMedia('(prefers-color-scheme: dark)')");
  });
});

describe('LandingPage responsive breakpoints (mobile spec)', () => {
  it('stacks the steps and trust strips at base and restores 3 columns at md', () => {
    const html = render(null);
    expect(count(html, 'md:grid-cols-3')).toBe(2);
    expect(count(html, 'grid-cols-1')).toBe(2);
  });

  it('keeps the wrap affordance on the hero-pill and README flat-badge rows', () => {
    const html = render(null);
    // Hero pills wrap (spec: wrap — not scroll, not subset).
    expect(html).toContain('flex flex-wrap justify-center gap-[10px]');
    // README flat badges wrap; the fixed widths that remain are the badge SVGs.
    expect(html).toContain('flex flex-wrap gap-[7px]');
  });

  it('serves the inline-site card from one DOM: stacked base, grid from sm', () => {
    const html = render(null);
    expect(html).toContain('sm:grid-cols-[150px_1fr]');
    // The "GitHub (Private)" text takes the full row on mobile so the pills
    // drop to their own wrapped row; first pill right-aligns only from sm.
    expect(html).toContain('basis-full');
    expect(html).toContain('sm:basis-auto');
    expect(html).toContain('sm:ml-auto');
  });
});

describe('Layout responsive shell (mobile spec)', () => {
  it('pins the viewport meta tag', () => {
    const html = render(null);
    expect(html).toContain('name="viewport" content="width=device-width, initial-scale=1"');
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

describe('LandingPage footer (shared shell)', () => {
  it('renders the build-constant footer on both cache variants', () => {
    for (const auth of [null, authed(2)] as const) {
      const html = render(auth);
      expect(html).toContain('<footer');
      // Attribution is its own centered grid cell now (no ' · ' concatenation).
      expect(html).toContain('Built by');
      expect(html).toContain('href="https://wnston.dev"');
    }
  });
});
