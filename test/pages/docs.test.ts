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
  it('renders all ten sections s1–s10 with their headings', () => {
    const html = render();
    for (let i = 1; i <= 10; i++) expect(html).toContain(`id="s${i}"`);
    for (const heading of [
      'What GitCert is',
      'Install',
      'The badges',
      'Using a badge',
      'The verify certificate',
      'The JSON API',
      'Managing repos',
      'Disconnecting or switching',
      'Trust model',
      'Self-hosting',
    ]) {
      expect(html).toContain(heading);
    }
  });

  it('renumbers the eyebrows in lockstep with the ids (s6 inserted, rest shift)', () => {
    const html = render();
    for (const eyebrow of [
      '06 · Reference', // The JSON API — the new section
      '07 · Managing',
      '08 · Important',
      '09 · Trust',
      '10 · Advanced',
    ]) {
      expect(html).toContain(eyebrow);
    }
    // The pre-shift numbering must be gone from those four sections.
    expect(html).not.toContain('06 · Managing');
    expect(html).not.toContain('07 · Important');
    expect(html).not.toContain('08 · Trust');
    expect(html).not.toContain('09 · Advanced');
  });

  it('offers a section nav to every anchor (sidebar desktop + jump-list mobile)', () => {
    const html = render();
    for (let i = 1; i <= 10; i++) {
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
    expect(script).toContain("['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10']");
    expect(script).not.toContain('${');
    expect(script).not.toContain('octocat');
    // Identical regardless of the account prop — nothing user-derived leaks in.
    expect(scrollspyScript(render(null))).toBe(scrollspyScript(render({ handle: 'anyone' })));
  });

  it('hooks every desktop sidebar link with data-spy-link and pre-marks s1 active', () => {
    const html = render();
    // Ten sidebar links carry the scoping hook (the mobile jump-list does not).
    // Match the rendered attribute so the script's own `[data-spy-link]`
    // selector string is not miscounted as a link.
    expect(count(html, 'data-spy-link="true"')).toBe(10);
    // Server-rendered initial active state so the first paint (and the
    // JS-disabled state) shows "01 Overview" highlighted — exactly one link.
    expect(count(html, 'data-active=""')).toBe(1);
  });

  it('degrades gracefully — spy links are still plain #anchors', () => {
    const html = render();
    // Every spy link is an <a href="#sN"> so navigation works with JS disabled;
    // only the scroll-driven highlight needs the observer.
    for (let i = 1; i <= 10; i++) {
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
      // s6 envelope-field card: stacked at base, two-column grid at sm.
      '.sm\\:contents',
      '.sm\\:grid-cols-\\[auto_1fr\\]',
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

describe('DocsPage disconnect-vs-switch (now s8)', () => {
  it('distinguishes switching accounts (sign out) from revoking access (uninstall)', () => {
    const html = render();
    const s8 = html.slice(html.indexOf('id="s8"'), html.indexOf('id="s9"'));
    expect(s8).toContain('Switch account');
    expect(s8).toContain('session only');
    expect(s8).toContain('Sign out');
    expect(s8).toContain('Revoke access');
    expect(s8).toContain('uninstall the app');
    // The precise uninstall path and the external revoke link.
    expect(s8).toContain('Installed GitHub Apps');
    expect(s8).toContain('href="https://github.com/settings/installations"');
    expect(s8).toContain('not found');
  });
});

/**
 * s6 truthfulness. The design mock's JSON envelope and verify recipe were
 * PLACEHOLDERS and were factually wrong; these assertions are the guard that
 * stops the docs drifting back into fiction. Every field name below is
 * verifiable against src/lib/payload.ts, src/routes/api.ts and src/lib/sign.ts.
 */
describe('DocsPage — The JSON API (s6)', () => {
  /** Hono escapes quotes in text children; decode so assertions stay readable. */
  function decode(html: string): string {
    return html
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<');
  }

  function s6(): string {
    const html = render();
    return decode(html.slice(html.indexOf('id="s6"'), html.indexOf('id="s7"')));
  }

  it('renders all eight beats in order', () => {
    const s = s6();
    const beats = [
      'A badge is one rendering of a signed record',
      'Endpoint',
      'curl -s https://gitcert.harborstack.app/api/johndoe/client-platform.json',
      'excluded, uninstalled, and never-created are answered identically',
      'Response',
      'public_key_url',
      'pretty-printed for reading',
      'Verify it yourself',
      'Verify the bytes, not your reading of them',
    ];
    let cursor = -1;
    for (const beat of beats) {
      const at = s.indexOf(beat, cursor + 1);
      expect(at, `beat out of order or missing: ${beat}`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it('ships the REAL canonical payload field names (src/lib/payload.ts)', () => {
    const s = s6();
    for (const field of [
      '"cert_serial"',
      '"collected_at"',
      '"issuer"',
      '"method"',
      '"private"',
      '"repo"',
      '"stats"',
      '"v"',
      '"signature"',
      '"public_key_url"',
    ]) {
      expect(s, `missing envelope field ${field}`).toContain(field);
    }
    // Deep-sorted stats keys, exactly as buildCanonicalPayload emits them.
    for (const field of [
      '"commits"',
      '"created_at"',
      '"first_commit_at"',
      '"language_pct"',
      '"languages"',
      '"last_commit_at"',
      '"open_issues"',
      '"open_prs"',
      '"primary_language"',
      '"size_kb"',
    ]) {
      expect(s, `missing stats field ${field}`).toContain(field);
    }
  });

  it('carries none of the mock’s invented fields or the fake algorithm prefix', () => {
    const s = s6();
    // The mock's placeholder shape — none of it exists in the real payload.
    for (const fiction of [
      'cert_id',
      '"metrics"',
      '"attested_at"',
      '"owner"',
      '"last_commit"',
      '"size_bytes"',
      '"first_commit"',
    ]) {
      expect(s, `mock fiction resurfaced: ${fiction}`).not.toContain(fiction);
    }
    // src/lib/sign.ts returns BARE base64 — there is no prefix to strip.
    expect(s).not.toContain('ed25519:');
    expect(s).not.toContain("split(':'");
  });

  it('never claims key rotation — there is one key, derived per request', () => {
    const s = s6().toLowerCase();
    for (const phrase of ['rotation', 'rotate', 'retired key', 'old certificates keep verifying']) {
      expect(s, `unsupported key-rotation claim: ${phrase}`).not.toContain(phrase);
    }
    // What /pubkey actually answers with.
    expect(s6()).toContain('algorithm');
    expect(s6()).toContain('jwk');
    expect(s6()).toContain('raw 32-byte Ed25519 key');
  });

  it('recipe slices the served bytes and never re-serializes them', () => {
    const s = s6();
    expect(s).toContain(`raw.index(b'"payload":')`);
    // Mirrors verify.tsx's lastIndexOf(',"signature"').
    expect(s).toContain(`raw.rindex(b',"signature"')`);
    expect(s).toContain('payload = raw[start:end]');
    expect(s).toContain('re-serializing them');
    // A JSON round-trip on the signed bytes is the one thing that must never
    // appear here — it reorders/reformats and fails a valid certificate.
    expect(s).not.toContain('json.dumps');
  });

  it('recipe reads the key out of /pubkey’s JSON and the serial from cert_serial', () => {
    const s = s6();
    expect(s).toContain("['public_key']");
    expect(s).toContain("json.load(open('gitcert.pub.json'))");
    expect(s).toContain("json.loads(payload)['cert_serial']");
    // The mock read a raw base64 file; /pubkey serves JSON.
    expect(s).not.toContain("open('gitcert.pub').read()");
  });

  it('stacks the field card at base and grids it at sm (mobile mock)', () => {
    const s = s6();
    expect(s).toContain('flex flex-col gap-3');
    expect(s).toContain('sm:grid');
    expect(s).toContain('sm:grid-cols-[auto_1fr]');
    // Each pair flattens into the parent grid at sm, stays stacked at base.
    expect(count(s, 'sm:contents')).toBe(3);
  });

  it('states the no-existence-oracle guarantee without becoming one', () => {
    const s = s6();
    expect(s).toContain('excluded, uninstalled, and never-created are answered identically');
    expect(s).toContain('tells the caller nothing about what does or does not exist on GitHub');
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
