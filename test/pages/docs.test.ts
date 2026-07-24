import { describe, expect, it } from 'vitest';
import { DocsPage, type DocsPageProps } from '../../src/pages/docs';

function render(account: DocsPageProps['account'] = null): string {
  return String(DocsPage({ account }));
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
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
