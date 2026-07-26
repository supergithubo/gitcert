/**
 * Shared shell guards (UI polish batch): the wordmark→landing link, the
 * favicon (a filled variant reusing the canonical seal geometry — never a
 * redrawn copy), and the site footer (build-constant only: it also renders
 * into the cached signed-out landing variant).
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { version as pkgVersion } from '../../package.json';
import { sealSvg } from '../../src/badges/seal';
import { GITHUB_MARK_PATH, GITHUB_REPO_URL, Layout, initials } from '../../src/pages/layout';

function render(): string {
  return String(Layout({ title: 'GitCert — test', children: 'page-body-marker' }));
}

function renderWithAccount(handle: string): string {
  return String(Layout({ title: 'GitCert — test', account: { handle }, children: 'page-body' }));
}

/** The header only (nav), sliced off before the page body / footer. */
function nav(html: string): string {
  return html.slice(0, html.indexOf('<div class="flex-1">'));
}

describe('Layout nav wordmark', () => {
  it('links the seal+wordmark to / (landing) without link-style leakage', () => {
    const html = render();
    const start = html.indexOf('href="/"');
    expect(start).toBeGreaterThan(-1);
    const anchorOpen = html.lastIndexOf('<a', start);
    const anchor = html.slice(anchorOpen, html.indexOf('</a>', anchorOpen));
    expect(anchor).toContain('GitCert');
    expect(anchor).toContain('<circle cx="12" cy="12" r="10"'); // seal, not a copy
    // data-nav suppresses the base a:hover underline; text-ink beats the
    // base accent link color — appearance identical to the old static div.
    expect(anchor).toContain('data-nav');
    expect(anchor).toContain('text-ink');
    expect(anchor).toContain('font-mono text-[16px] font-semibold tracking-[-0.4px]');
  });

  it('carries the seal hover-draw hook, emitted by seal.ts and not the call site', () => {
    const html = render();
    // The attribute reaches the header purely because sealSvg() emits it —
    // layout.tsx passes no flag, so the seal stays the single draw site.
    expect(html).toContain('<path data-seal-check d="m9 12 2 2 4-4"');
    expect(sealSvg({ size: 19, kind: 'check', color: 'var(--accent)' })).toContain(
      'data-seal-check',
    );
  });
});

describe('Layout favicon', () => {
  it('declares the SVG icon in <head>', () => {
    const html = render();
    const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
    expect(head).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg"');
  });

  it('public/favicon.svg reuses the canonical seal geometry, filled for tab visibility', () => {
    // A favicon is ~16px in a tab: the in-UI seal (thin 2px stroke on a
    // TRANSPARENT ground) vanishes at that size. The favicon is therefore a
    // FILLED variant — accent disc + white check — but reuses the exact
    // canonical geometry so it stays the same mark: same circle center and
    // the identical check path emitted by src/badges/seal.ts.
    const svg = env.TEST_FAVICON_SVG;
    // Same check path as the canonical seal (sourced from seal.ts, not redrawn).
    expect(sealSvg({ size: 24, kind: 'check', color: '#2f6d4f' })).toContain('d="m9 12 2 2 4-4"');
    expect(svg).toContain('d="m9 12 2 2 4-4"');
    // Same circle center as the canonical seal.
    expect(svg).toContain('cx="12" cy="12"');
    // Filled accent disc (visibility) with a white check (contrast) — the
    // two properties the transparent-stroke in-UI seal lacks at 16px.
    expect(svg).toContain('fill="#2f6d4f"');
    expect(svg).toContain('stroke="#ffffff"');
    expect(svg).toContain('viewBox="0 0 24 24"');
  });
});

describe('Layout footer', () => {
  it('renders on the panel-tinted band below the page body', () => {
    const html = render();
    const footerAt = html.indexOf('<footer');
    expect(footerAt).toBeGreaterThan(html.indexOf('page-body-marker'));
    const footer = html.slice(footerAt, html.indexOf('</footer>'));
    expect(footer).toContain('border-t border-hair bg-panel');
    // Small mono at base, one step up from sm.
    expect(footer).toContain('font-mono text-[11px] text-muted');
    expect(footer).toContain('sm:text-[12px]');
  });

  it('puts the base centered stack AND the sm: 3-column grid on the one parent', () => {
    const html = render();
    // Both layouts only work if every class sits on the direct parent of the
    // three footer cells — grab that element's own class list, not the subtree.
    const inner = /<footer class="[^"]+"><div class="([^"]+)">/.exec(html);
    expect(inner).not.toBeNull();
    const cls = ` ${inner?.[1]} `;
    for (const c of [
      'flex',
      'flex-col', // base: centered vertical stack
      'items-center',
      'justify-center',
      'sm:grid', // desktop: the grid display wins, flex-col goes inert
      'sm:grid-cols-[1fr_auto_1fr]', // copyright · attribution · GitHub
      'sm:items-center',
      'sm:min-h-[52px]',
      'mx-auto',
      'max-w-[1120px]', // aligned to the page content column, not the viewport
    ]) {
      expect(cls).toContain(` ${c} `);
    }
    // Superseded 2-part split — the middle cell can't center between them.
    expect(cls).not.toContain(' sm:flex-row ');
    expect(cls).not.toContain(' sm:justify-between ');
  });

  it('renders exactly three cells, ordered version → attribution → GitHub', () => {
    const html = render();
    const footer = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
    const version = footer.indexOf('GitCert v');
    const built = footer.indexOf('Built by');
    const github = footer.indexOf('View on GitHub');
    // Source order already equals the mobile stacking order, so the mobile
    // layout needs no order-* utilities.
    expect(version).toBeGreaterThan(-1);
    expect(built).toBeGreaterThan(version);
    expect(github).toBeGreaterThan(built);
    // Each cell claims its own grid column at sm.
    expect(footer).toContain('sm:justify-self-start');
    expect(footer).toContain('sm:justify-self-center');
    expect(footer).toContain('sm:justify-self-end');
    // All three stay on one line at desktop.
    expect(footer.split('whitespace-nowrap').length - 1).toBe(3);
  });

  it('has every footer-layout utility in the COMPILED stylesheet (stale-build guard)', () => {
    // public/styles.css is a build artifact (npm run build:css). A class in
    // JSX that was never compiled silently no-ops in the browser — this is
    // exactly how the footer once rendered stacked+centered at desktop
    // (flex-col + sm:items-center were compiled, sm:flex-row was not).
    const css = env.TEST_COMPILED_CSS;
    for (const sel of [
      '.flex-col',
      '.sm\\:grid',
      '.sm\\:grid-cols-\\[1fr_auto_1fr\\]',
      '.sm\\:items-center',
      '.sm\\:justify-self-start',
      '.sm\\:justify-self-center',
      '.sm\\:justify-self-end',
      '.sm\\:min-h-\\[52px\\]',
      '.py-\\[14px\\]',
      '.gap-2',
      '.text-\\[11px\\]',
      '.sm\\:text-\\[12px\\]',
      '.max-w-\\[1120px\\]',
    ]) {
      expect(css, `missing compiled utility ${sel} — run npm run build:css`).toContain(sel);
    }
  });

  it('shows the build-time version from root package.json (single source)', () => {
    const html = render();
    expect(html).toContain(`GitCert v${pkgVersion}`);
  });

  it('links View on GitHub and wnston.dev with the nav target/rel pattern', () => {
    const html = render();
    const footer = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
    expect(footer).toContain(`href="${GITHUB_REPO_URL}"`);
    expect(footer).toContain('View on GitHub');
    // The attribution is its own centered cell now — it no longer concatenates
    // onto the GitHub link, so the leading ' · ' separator is gone.
    expect(footer).toContain('Built by');
    expect(footer).not.toContain(' · Built by ');
    const credit = footer.slice(footer.indexOf('href="https://wnston.dev"'));
    expect(credit).toContain('wnston.dev</a>');
    // Both external links open safely in a new tab, muted (no accent leak).
    for (const anchor of footer.split('<a ').slice(1)) {
      expect(anchor).toContain('target="_blank"');
      expect(anchor).toContain('rel="noopener"');
      expect(anchor).toContain('text-muted');
    }
  });

  it('keeps the footer pinned via the body flex column', () => {
    const html = render();
    expect(html).toContain('flex min-h-screen flex-col');
    expect(html).toContain('<div class="flex-1">');
  });

  it('carries the GitHub mark on the footer View-on-GitHub link (moved from the header)', () => {
    const html = render();
    const footer = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
    // The anchor that reads "View on GitHub" now wraps the octocat path.
    const anchor = footer.slice(footer.indexOf('href="' + GITHUB_REPO_URL));
    const anchorEnd = anchor.indexOf('</a>');
    expect(anchor.slice(0, anchorEnd)).toContain(GITHUB_MARK_PATH);
  });
});

describe('Layout nav restructure (third export)', () => {
  it('adds a Documentation link to /docs, centered and muted (aligned with account menu + toggle)', () => {
    const header = nav(render());
    const at = header.indexOf('href="/docs"');
    expect(at).toBeGreaterThan(-1);
    const open = header.slice(header.lastIndexOf('<a', at), header.indexOf('>', at));
    expect(open).toContain('data-nav');
    expect(open).toContain('text-muted');
    // Plain centered flex item — no vertical-offset scaffolding (mt-/pb-/border-b)
    // that pushed it 3px below the account menu + theme toggle. items-center only.
    expect(open).toContain('items-center');
    expect(open).not.toContain('border-b-2');
    expect(open).not.toContain('mt-[6px]');
    expect(open).not.toContain('pb-[6px]');
    // Accent discipline (decision 10c): nav links stay muted — never accent.
    expect(open).not.toContain('accent');
    expect(header).toContain('>Documentation</a>');
  });

  it('removes "View on GitHub" from the header (it lives in the footer now)', () => {
    const header = nav(render());
    expect(header).not.toContain('View on GitHub');
    expect(header).not.toContain(GITHUB_REPO_URL);
  });

  it('renders the signed-out nav with no account menu', () => {
    const header = nav(render());
    expect(header).not.toContain('data-account-menu');
    expect(header).not.toContain('signed in via GitHub');
    expect(header).not.toContain('/auth/logout');
  });
});

describe('Layout account menu (signed-in)', () => {
  it('renders the account menu only when an account is supplied', () => {
    expect(render()).not.toContain('data-account-menu');
    expect(renderWithAccount('octocat')).toContain('data-account-menu');
  });

  it('shows the @handle, server-side initials, and "signed in via GitHub"', () => {
    const html = renderWithAccount('octocat');
    expect(html).toContain('@octocat');
    expect(html).toContain('signed in via GitHub');
    // Initials computed server-side (mock's client JS not ported).
    expect(html).toContain('>oc</span>');
  });

  it('signs out via a POST form to /auth/logout (a button, not a link)', () => {
    const html = renderWithAccount('octocat');
    expect(html).toMatch(/<form method="post" action="\/auth\/logout"[^>]*>/);
    expect(html).toContain('Sign out');
    expect(html).toContain('type="submit"');
  });

  it('offers a subordinate external Disconnect link to GitHub app settings', () => {
    const html = renderWithAccount('octocat');
    const at = html.indexOf('href="https://github.com/settings/installations"');
    expect(at).toBeGreaterThan(-1);
    const open = html.slice(html.lastIndexOf('<a', at), html.indexOf('>', at));
    expect(open).toContain('target="_blank"');
    expect(open).toContain('rel="noopener"');
    expect(open).toContain('text-muted');
    expect(html).toContain('Disconnect GitCert from GitHub');
    expect(html).toContain('your badges stop resolving');
  });

  it('is a pure-CSS disclosure — the handle never enters any inline script', () => {
    const html = renderWithAccount('octocat');
    expect(html).toContain('<details data-account-menu');
    expect(html).toContain('<summary');
    const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    for (const s of scripts) expect(s).not.toContain('octocat');
  });

  it('has the account-menu utilities and caret rule in the compiled stylesheet', () => {
    const css = env.TEST_COMPILED_CSS;
    expect(css, 'run npm run build:css').toContain('.w-\\[276px\\]');
    expect(css).toContain('[data-account-menu][open]');
  });
});

describe('initials()', () => {
  it('takes the first two alphanumerics, lowercased', () => {
    expect(initials('Octocat')).toBe('oc');
    expect(initials('John-Doe')).toBe('jo');
    expect(initials('9lives')).toBe('9l');
  });

  it('falls back to gh when a handle has no alphanumerics', () => {
    expect(initials('')).toBe('gh');
    expect(initials('__@!')).toBe('gh');
  });
});
