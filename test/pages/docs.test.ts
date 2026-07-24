import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { DocsPage, type DocsPageProps } from '../../src/pages/docs';

function render(account: DocsPageProps['account'] = null): string {
  return String(DocsPage({ account }));
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

/** The s3 badge grid markup (from the eyebrow anchor to the s4 section). */
function s3Slice(html: string): string {
  return html.slice(html.indexOf('id="s3"'), html.indexOf('id="s4"'));
}

/** The inline scrollspy <script> body. */
function scrollspyScript(html: string): string {
  const marker = 'IntersectionObserver';
  const scriptOpen = html.lastIndexOf('<script>', html.indexOf(marker));
  return html.slice(scriptOpen, html.indexOf('</script>', scriptOpen));
}

describe('DocsPage structure', () => {
  it('renders all nine sections s1–s9 with their headings', () => {
    const html = render();
    for (let i = 1; i <= 9; i++) expect(html).toContain(`id="s${i}"`);
    for (const heading of [
      'What GitCert is',
      'Install',
      'The badges',
      'Using a badge',
      'The verify certificate',
      'Managing repos',
      'Disconnecting or switching',
      'Trust model',
      'Self-hosting',
    ]) {
      expect(html).toContain(heading);
    }
  });

  it('offers a section nav to every anchor (sidebar desktop + jump-list mobile)', () => {
    const html = render();
    for (let i = 1; i <= 9; i++) {
      // Each id is linked at least twice: the sticky sidebar and the mobile
      // jump-list both reference #s{i}.
      expect(count(html, `href="#s${i}"`)).toBeGreaterThanOrEqual(2);
    }
    expect(count(html, 'On this page')).toBeGreaterThanOrEqual(2);
  });

  it('sets the page title', () => {
    expect(render()).toContain('<title>GitCert — documentation</title>');
  });
});

describe('DocsPage scrollspy active-nav (issue #1)', () => {
  it('ships one inline IntersectionObserver script with the mock rootMargin', () => {
    const script = scrollspyScript(render());
    expect(script).toContain('IntersectionObserver');
    expect(script).toContain("rootMargin: '-25% 0px -65% 0px'");
    expect(script).toContain('threshold: 0');
  });

  it('is a constant script with ZERO interpolated user data (XSS discipline)', () => {
    // The only dynamic tokens are the static section ids s1..s9 — assert the
    // literal id array is present and no template interpolation survived.
    const script = scrollspyScript(render({ handle: 'octocat' }));
    expect(script).toContain("['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9']");
    expect(script).not.toContain('${');
    expect(script).not.toContain('octocat');
    // Identical regardless of the account prop — nothing user-derived leaks in.
    expect(scrollspyScript(render(null))).toBe(scrollspyScript(render({ handle: 'anyone' })));
  });

  it('hooks every desktop sidebar link with data-spy-link and pre-marks s1 active', () => {
    const html = render();
    // Nine sidebar links carry the scoping hook (the mobile jump-list does not).
    // Match the rendered attribute so the script's own `[data-spy-link]`
    // selector string is not miscounted as a link.
    expect(count(html, 'data-spy-link="true"')).toBe(9);
    // Server-rendered initial active state so the first paint (and the
    // JS-disabled state) shows "01 Overview" highlighted — exactly one link.
    expect(count(html, 'data-active=""')).toBe(1);
  });

  it('degrades gracefully — spy links are still plain #anchors', () => {
    const html = render();
    // Every spy link is an <a href="#sN"> so navigation works with JS disabled;
    // only the scroll-driven highlight needs the observer.
    for (let i = 1; i <= 9; i++) {
      expect(html).toContain(`href="#s${i}"`);
    }
    // No smooth-scroll / preventDefault machinery was ported (native anchors).
    expect(scrollspyScript(html)).not.toContain('preventDefault');
  });
});

describe('DocsPage s3 badge column alignment (issue #2)', () => {
  it('lays the badge grid out as a CSS table at sm (aligns metric | flat | pill)', () => {
    const s3 = s3Slice(render());
    // The CSS-table structure is what column-aligns variable-width badges.
    expect(s3).toContain('sm:table');
    expect(s3).toContain('sm:table-row');
    expect(s3).toContain('sm:table-cell');
    expect(s3).toContain('sm:align-middle');
    // Cells hold their column width regardless of badge width.
    expect(s3).toContain('whitespace-nowrap');
    // The pill column absorbs the remaining width.
    expect(s3).toContain('sm:w-full');
    // Horizontal scroll rather than clipping when a badge overflows.
    expect(s3).toContain('overflow-x-auto');
  });

  it('keeps the base-breakpoint stacked treatment with inline flat/pill labels', () => {
    const s3 = s3Slice(render());
    // 8 rows still self-label at base (mobile) with a mini "flat"/"pill" tag.
    expect(count(s3, 'sm:hidden')).toBe(16);
    expect(s3).toContain('flex flex-col');
  });

  it('leaves the badge SVG samples byte-frozen (16 live production SVGs)', () => {
    // Layout-only change: the sample count and formatting are unchanged.
    expect(count(render(), 'role="img"')).toBe(16);
  });
});

describe('DocsPage back-to-dashboard link (issue #3, docs half)', () => {
  it('renders the muted mono back-link only when signed in', () => {
    const signedIn = render({ handle: 'octocat' });
    expect(signedIn).toContain('← Back to dashboard');
    const back = signedIn.slice(signedIn.indexOf('← Back to dashboard') - 200);
    expect(back).toContain('href="/dashboard"');
  });

  it('omits the back-link on the signed-out (cacheable) render', () => {
    expect(render(null)).not.toContain('Back to dashboard');
  });
});

describe('DocsPage stale-build guard (compiled styles.css)', () => {
  it('has every new scrollspy/table/back-link utility compiled (run build:css)', () => {
    const css = env.TEST_COMPILED_CSS;
    for (const sel of [
      '.sm\\:table',
      '.sm\\:table-row',
      '.sm\\:table-cell',
      '.sm\\:align-middle',
      '.sm\\:border-collapse',
      '.overflow-x-auto',
      '.sm\\:pr-\\[22px\\]',
      '.sm\\:pl-\\[18px\\]',
    ]) {
      expect(css, `missing compiled utility ${sel} — run npm run build:css`).toContain(sel);
    }
  });
});

describe('DocsPage badge samples (s3)', () => {
  it('renders the eight metrics in both styles via the production templates', () => {
    const html = render();
    // 8 metrics × {flat, pill} = 16 live SVGs.
    expect(count(html, 'role="img"')).toBe(16);
    // Production formatting, not the mock blobs.
    expect(html).toContain('1,247');
    expect(html).not.toContain('1.2k');
    expect(html).toContain('open issues');
    expect(html).toContain('1d ago');
    expect(html).toContain('TypeScript 81%');
    expect(html).toContain('47 MB');
    // theme=auto badges follow prefers-color-scheme inside the SVG.
    expect(html).toContain('prefers-color-scheme');
  });

  it('keeps every inline flat-badge clipPath id unique across the document', () => {
    const html = render();
    const ids = [...html.matchAll(/<clipPath id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(8);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('anonymizes the badge demo identity (decision #2)', () => {
    const html = render();
    expect(html).toContain('johndoe/client-platform');
  });
});

describe('DocsPage account menu (session-aware nav)', () => {
  it('omits the account menu on the signed-out (cacheable) render', () => {
    const html = render(null);
    expect(html).not.toContain('data-account-menu');
    expect(html).not.toContain('signed in via GitHub');
  });

  it('shows the account menu when an account is supplied', () => {
    const html = render({ handle: 'octocat' });
    expect(html).toContain('data-account-menu');
    expect(html).toContain('@octocat');
  });
});

describe('DocsPage disconnect-vs-switch (s7)', () => {
  it('distinguishes switching accounts (sign out) from revoking access (uninstall)', () => {
    const html = render();
    const s7 = html.slice(html.indexOf('id="s7"'), html.indexOf('id="s8"'));
    expect(s7).toContain('Switch account');
    expect(s7).toContain('session only');
    expect(s7).toContain('Sign out');
    expect(s7).toContain('Revoke access');
    expect(s7).toContain('uninstall the app');
    // The precise uninstall path and the external revoke link.
    expect(s7).toContain('Installed GitHub Apps');
    expect(s7).toContain('href="https://github.com/settings/installations"');
    expect(s7).toContain('not found');
  });
});

/**
 * Banned phrasings (all lowercased) that imply metadata-only / source-
 * unreadability — the decision #5 honesty violation. The read-only card once
 * read "Counts and dates only. Never your source, never a write.", which the
 * original exact-string tripwire ("never read your source") missed. This list
 * catches the CLASS: any claim that GitCert only reads counts/metadata or
 * cannot read source. The honest frame is read-only = never WRITES; the App
 * does hold Contents:Read (see the s2 permissions card), and the value is that
 * the OUTPUT proves stats without a viewer seeing code.
 *
 * None of these may false-positive against legitimate copy — the page uses
 * "asks only for read access", "only ever touches", "usually only for a
 * moment", "session only", which are scope/timing, not read-denial.
 */
const BANNED_COPY = [
  'metadata-only',
  'metadata only',
  'never read your source',
  'can never read',
  "can't read your source",
  'cannot read your source',
  'never your source', // the phrasing that slipped past the old tripwire
  'counts and dates only', // …and its companion, the read-only card body
  'only counts and',
  'reads only',
  'sees only',
  'only sees',
] as const;

describe('DocsPage copy rule (decision #5)', () => {
  it('never claims metadata-only or source unreadability', () => {
    const html = render().toLowerCase();
    for (const phrase of BANNED_COPY) {
      expect(html, `decision #5 violation: "${phrase}"`).not.toContain(phrase);
    }
  });

  it('is honest about the read scope and links the open-source collector', () => {
    const html = render();
    // The install permissions card shows Contents: Read-only, not a denial of reads.
    expect(html).toContain('Contents');
    expect(html).toContain('Read-only');
    expect(html).toContain('no write scope requested');
    // The collector is public and linked (SPEC repo).
    expect(html).toContain('https://github.com/supergithubo/gitcert');
    expect(html).toContain('Open-source collector');
  });
});
