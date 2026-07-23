/**
 * Shared page shell (hono rules: head, stylesheet, nav — pages compose it,
 * never duplicate it). The nav renders the logo/wordmark, "View on GitHub",
 * and the theme toggle from the mocks (restored by user decision, reversing
 * the M2 "no toggle" call). Theme defaults to `prefers-color-scheme`; the
 * toggle sets `data-gc-theme` on <html> and persists it in localStorage.
 */

import { raw } from 'hono/html';
import type { Child } from 'hono/jsx';
// Named JSON import — esbuild tree-shakes package.json down to this one
// field, so only the version string reaches the bundle (versioning rule:
// the version lives ONLY in root package.json, never hardcoded).
import { version } from '../../package.json';
import { sealSvg } from '../badges/seal';

export const GITHUB_REPO_URL = 'https://github.com/supergithubo/gitcert';

/**
 * First-paint theme restore. Runs inline in <head> BEFORE the stylesheet
 * paints so a persisted theme never flashes the media-query default. Like
 * the verify-button script (the sanctioned inline-JS precedent), it is a
 * constant string with no interpolated user data — it only reads the
 * localStorage key the toggle writes and whitelists its two values.
 */
const THEME_INIT_SCRIPT =
  `(function () {` +
  `try {` +
  `var t = localStorage.getItem('gc-theme');` +
  `if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-gc-theme', t);` +
  `} catch (e) {}` +
  `})();`;

/**
 * Header toggle behavior: derives the CURRENT effective theme (explicit
 * attribute, else prefers-color-scheme), flips it, sets `data-gc-theme` on
 * <html> (app.css attribute scopes override the media default and re-color
 * inline auto badges via the `--gc-*` svg overrides), and persists the
 * choice. Constant string, no interpolated user data.
 */
const THEME_TOGGLE_SCRIPT =
  `(function () {` +
  `var btn = document.getElementById('gc-theme-toggle');` +
  `if (!btn) return;` +
  `btn.addEventListener('click', function () {` +
  `var root = document.documentElement;` +
  `var current = root.getAttribute('data-gc-theme') || ` +
  `(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');` +
  `var next = current === 'dark' ? 'light' : 'dark';` +
  `root.setAttribute('data-gc-theme', next);` +
  `try { localStorage.setItem('gc-theme', next); } catch (e) {}` +
  `});` +
  `})();`;

/** GitHub octocat mark path (24×24 viewBox) — shared by the nav and the landing CTA. */
export const GITHUB_MARK_PATH =
  'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12';

export function Layout(props: { title: string; children?: Child }) {
  return (
    <>
      {raw('<!DOCTYPE html>')}
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{props.title}</title>
          <script>{raw(THEME_INIT_SCRIPT)}</script>
          <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
          <link rel="stylesheet" href="/styles.css" />
        </head>
        <body class="flex min-h-screen flex-col bg-paper font-display text-ink antialiased">
          <Nav />
          <div class="flex-1">{props.children}</div>
          <Footer />
          <script>{raw(THEME_TOGGLE_SCRIPT)}</script>
        </body>
      </html>
    </>
  );
}

function Nav() {
  return (
    <div class="sticky top-0 z-20 border-b border-hair bg-nav backdrop-blur-[6px]">
      <div class="mx-auto flex h-14 max-w-[1120px] items-center justify-between px-4 sm:h-[58px] sm:px-7">
        {/* data-nav suppresses the base a:hover underline; text-ink overrides
            the base accent link color — the wordmark keeps its exact look. */}
        <a data-nav href="/dashboard" class="flex items-center gap-[9px] text-ink">
          {raw(sealSvg({ size: 19, kind: 'check', color: 'var(--accent)' }))}
          <span class="font-mono text-[16px] font-semibold tracking-[-0.4px]">GitCert</span>
        </a>
        <div class="flex items-center gap-[22px]">
          <a
            data-nav
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener"
            class="mt-[6px] inline-flex items-center gap-[7px] border-b-2 border-transparent pb-[6px] font-mono text-[13px] tracking-[0.2px] text-muted"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" class="block">
              <path d={GITHUB_MARK_PATH} />
            </svg>
            <span class="hidden sm:inline">View on GitHub</span>
          </a>
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

/**
 * Site footer on every page (the cached signed-out landing included — safe
 * because everything here is build-constant, nothing per-request). Muted
 * small mono over a panel-tinted band with a hairline top rule; splits
 * left/right from `sm:`, stacks at base width. Links override the base
 * accent link color with text-muted (accent stays reserved for verified
 * states); external links mirror the nav's target/rel pattern.
 */
function Footer() {
  return (
    <footer class="border-t border-hair bg-panel">
      <div class="mx-auto flex max-w-[1120px] flex-col gap-2 px-4 py-6 font-mono text-[12px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div>GitCert v{version}</div>
        <div>
          <a href={GITHUB_REPO_URL} target="_blank" rel="noopener" class="text-muted">
            View on GitHub
          </a>
          {' · Built by '}
          <a href="https://wnston.dev" target="_blank" rel="noopener" class="text-muted">
            wnston.dev
          </a>
        </div>
      </div>
    </footer>
  );
}

/** Mock sun glyph (shown in dark mode — click returns to light). */
const SUN_ICON =
  `<svg data-theme-icon="sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
  `<circle cx="12" cy="12" r="4"/>` +
  `<path d="M12 2v2"/><path d="m19.07 4.93-1.41 1.41"/><path d="M20 12h2"/><path d="m17.66 17.66 1.41 1.41"/>` +
  `<path d="M12 20v2"/><path d="m6.34 17.66-1.41 1.41"/><path d="M2 12h2"/><path d="m4.93 4.93 1.41 1.41"/>` +
  `</svg>`;

/** Mock moon glyph (shown in light mode — click switches to dark). */
const MOON_ICON =
  `<svg data-theme-icon="moon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
  `<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>` +
  `</svg>`;

/**
 * Header theme toggle (mock modeBtnStyle: 30px circle, hair-strong border,
 * ink glyph). Both glyphs are rendered; app.css swaps visibility from the
 * effective theme so the server markup stays theme-agnostic.
 */
function ThemeToggle() {
  return (
    <button
      id="gc-theme-toggle"
      type="button"
      aria-label="toggle theme"
      class="grid h-[30px] w-[30px] cursor-pointer place-items-center rounded-full border border-hair-strong bg-transparent p-0 text-ink"
    >
      {raw(SUN_ICON)}
      {raw(MOON_ICON)}
    </button>
  );
}
