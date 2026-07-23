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
    // Anonymization covers the MOCK DATA only — the footer's "Built by
    // wnston.dev" credit is intentional real identity (user decision,
    // UI polish batch). Nothing outside the footer may leak it.
    const beforeFooter = html.slice(0, html.indexOf('<footer'));
    expect(beforeFooter).not.toContain('wnston');
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

describe('LandingPage accent discipline (mock authority)', () => {
  it('renders both CTAs as ink buttons with paper text, never accent', () => {
    for (const auth of [null, { attestedCount: 2 }] as const) {
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

  it('keeps the nav GitHub link muted (mock: color var(--muted))', () => {
    const html = render(null);
    const openTag = html.slice(
      html.indexOf('data-nav="true" href="https://github.com/supergithubo/gitcert"'),
    );
    expect(openTag.slice(0, openTag.indexOf('>'))).toContain('text-muted');
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
    // Mock moon path, and the toggle sits after the GitHub link.
    expect(html).toContain('M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z');
    expect(html.indexOf('View on GitHub')).toBeLessThan(html.indexOf('gc-theme-toggle'));
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

  it('hides the GitHub nav label below sm while the icon stays', () => {
    const html = render(null);
    expect(html).toContain('<span class="hidden sm:inline">View on GitHub</span>');
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
    for (const auth of [null, { attestedCount: 2 }] as const) {
      const html = render(auth);
      expect(html).toContain('<footer');
      expect(html).toContain('· Built by ');
      expect(html).toContain('href="https://wnston.dev"');
    }
  });
});
