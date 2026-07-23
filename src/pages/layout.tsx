/**
 * Shared page shell (hono rules: head, stylesheet, nav — pages compose it,
 * never duplicate it). Ported from the verify mock: the M2 nav renders only
 * the logo/wordmark and "View on GitHub". Theme follows
 * `prefers-color-scheme` — the design-tool toggle was not ported.
 */

import { raw } from 'hono/html';
import type { Child } from 'hono/jsx';
import { sealSvg } from '../badges/seal';

export const GITHUB_REPO_URL = 'https://github.com/supergithubo/gitcert';

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
          <link rel="stylesheet" href="/styles.css" />
        </head>
        <body class="min-h-screen bg-paper font-display text-ink antialiased">
          <Nav />
          {props.children}
        </body>
      </html>
    </>
  );
}

function Nav() {
  return (
    <div class="sticky top-0 z-20 border-b border-hair bg-nav backdrop-blur-[6px]">
      <div class="mx-auto flex h-[58px] max-w-[1120px] items-center justify-between px-7">
        <div class="flex items-center gap-[9px]">
          {raw(sealSvg({ size: 19, kind: 'check', color: 'var(--accent)' }))}
          <span class="font-mono text-[16px] font-semibold tracking-[-0.4px]">GitCert</span>
        </div>
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
            View on GitHub
          </a>
        </div>
      </div>
    </div>
  );
}
