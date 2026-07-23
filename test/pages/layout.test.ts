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
import { GITHUB_REPO_URL, Layout } from '../../src/pages/layout';

function render(): string {
  return String(Layout({ title: 'GitCert — test', children: 'page-body-marker' }));
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
    expect(footer).toContain('font-mono text-[12px] text-muted');
  });

  it('puts the base stack AND the sm: left/right split on the one flex parent', () => {
    const html = render();
    // The split only works if every class sits on the direct parent of the
    // two footer cells — grab that element's own class list, not the subtree.
    const inner = /<footer class="[^"]+"><div class="([^"]+)">/.exec(html);
    expect(inner).not.toBeNull();
    const cls = ` ${inner?.[1]} `;
    for (const c of [
      'flex',
      'flex-col', // base: stacked
      'sm:flex-row', // desktop: one row
      'sm:items-center',
      'sm:justify-between', // version flush left, links flush right
      'mx-auto',
      'max-w-[1120px]', // aligned to the page content column, not the viewport
    ]) {
      expect(cls).toContain(` ${c} `);
    }
  });

  it('has every footer-split utility in the COMPILED stylesheet (stale-build guard)', () => {
    // public/styles.css is a build artifact (npm run build:css). A class in
    // JSX that was never compiled silently no-ops in the browser — this is
    // exactly how the footer once rendered stacked+centered at desktop
    // (flex-col + sm:items-center were compiled, sm:flex-row was not).
    const css = env.TEST_COMPILED_CSS;
    for (const sel of [
      '.flex-col',
      '.sm\\:flex-row',
      '.sm\\:items-center',
      '.sm\\:justify-between',
      '.py-6',
      '.gap-2',
      '.text-\\[12px\\]',
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
    expect(footer).toContain(' · Built by ');
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
});
