import { describe, expect, it } from 'vitest';
import {
  DashboardPage,
  type DashboardAccount,
  type DashboardPageProps,
  type DashboardRepo,
} from '../../src/pages/dashboard';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Relative to the real clock — the page derives row state from `Date.now()`. */
function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function fixtureRepo(overrides: Partial<DashboardRepo> = {}): DashboardRepo {
  return {
    id: 101,
    owner: 'wnston',
    name: 'client-platform',
    private: true,
    included: true,
    collectedAt: isoAgo(2 * MINUTE_MS),
    ...overrides,
  };
}

function fixtureAccount(overrides: Partial<DashboardAccount> = {}): DashboardAccount {
  return {
    installationId: 1,
    accountLogin: 'wnston',
    accountType: 'User',
    repos: [fixtureRepo()],
    ...overrides,
  };
}

/** Personal account (3 repos) followed by an org account (1 collecting repo). */
function fixtureProps(overrides: Partial<DashboardPageProps> = {}): DashboardPageProps {
  return {
    login: 'wnston',
    accounts: [
      fixtureAccount({
        repos: [
          fixtureRepo(),
          // Older than the 24h stale threshold.
          fixtureRepo({
            id: 102,
            name: 'open-cli',
            private: false,
            collectedAt: isoAgo(2 * DAY_MS),
          }),
          fixtureRepo({ id: 103, name: 'paused-repo', included: false }),
        ],
      }),
      fixtureAccount({
        installationId: 7,
        accountLogin: 'acme-labs',
        accountType: 'Organization',
        repos: [
          fixtureRepo({ id: 201, owner: 'acme-labs', name: 'gitcert-action', collectedAt: null }),
        ],
      }),
    ],
    ...overrides,
  };
}

function render(node: unknown): string {
  return String(node);
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

/** The markup slice for one repo row, from its wrapper to the next row/group. */
function rowBlock(html: string, id: number): string {
  const start = html.indexOf(`data-repo-row="true" data-repo-id="${id}"`);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, start + 1400);
}

describe('DashboardPage — header and account groups', () => {
  it('renders the eyebrow, h1, and shell', () => {
    const html = render(DashboardPage(fixtureProps()));
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Dashboard · @wnston');
    expect(html).toContain('Attest a repo, get a badge');
    expect(html).toContain('Accounts');
    // Shared shell footer reaches the dashboard too.
    expect(html).toContain('<footer');
    expect(html).toContain('· Built by ');
  });

  it('wires the signed-in account menu into the nav (handle threaded to Layout)', () => {
    const html = render(DashboardPage(fixtureProps({ login: 'wnston' })));
    expect(html).toContain('data-account-menu');
    expect(html).toContain('@wnston');
    // Sign-out is a POST form to /auth/logout (state-changing, not a link).
    expect(html).toContain('/auth/logout');
  });

  it('labels organization groups with an `org` chip and personal groups with none', () => {
    const html = render(DashboardPage(fixtureProps()));
    const personal = html.slice(html.indexOf('wnston<'), html.indexOf('acme-labs'));
    const org = html.slice(html.indexOf('acme-labs'));
    expect(org).toContain('>org<');
    expect(personal).not.toContain('>org<');
    // Exactly one chip — the personal group must not grow one.
    expect(count(html, '>org<')).toBe(1);
  });

  it('builds the per-account gear deep link from id + account type', () => {
    const html = render(DashboardPage(fixtureProps()));
    // Personal installation.
    expect(html).toContain('href="https://github.com/settings/installations/1"');
    // Org installations live under the org's own settings path.
    expect(html).toContain(
      'href="https://github.com/organizations/acme-labs/settings/installations/7"',
    );
    expect(count(html, 'title="Manage repos on GitHub"')).toBe(2);
    expect(html).toContain('aria-label="Manage repos on GitHub"');
    // No gear falls back to the comp's generic href. Scoped to the account
    // panel — the nav's "disconnect" link is a different control and stays.
    const panel = html.slice(html.indexOf('data-repo-scroll'), html.indexOf('install new account'));
    expect(panel).not.toContain('href="https://github.com/settings/installations"');
  });

  it('percent-encodes an account login inside the org gear href', () => {
    const accounts = [
      fixtureAccount({
        installationId: 9,
        accountLogin: 'a/b?c',
        accountType: 'Organization',
        repos: [fixtureRepo({ id: 301, owner: 'a/b?c', name: 'r' })],
      }),
    ];
    const html = render(DashboardPage(fixtureProps({ accounts })));
    expect(html).toContain(
      'href="https://github.com/organizations/a%2Fb%3Fc/settings/installations/9"',
    );
  });

  it('renders repo rows by short name with select buttons and sync buttons', () => {
    const html = render(DashboardPage(fixtureProps()));
    expect(html).toContain('>client-platform<');
    expect(html).toContain('>open-cli<');
    expect(html).toContain('>gitcert-action<');
    expect(html).toContain('data-repo-row="true" data-repo-id="101"');
    expect(html).toContain('data-repo-select="true" data-repo-id="103"');
    expect(count(html, 'data-repo-sync="true"')).toBe(4);
    // No per-row include toggle — the builder toggle is the only write path.
    expect(html).not.toContain('●');
    expect(html).not.toContain('○');
  });

  it('renders the repo count per group, singular at one', () => {
    const html = render(DashboardPage(fixtureProps()));
    expect(html).toContain('3 repos');
    expect(html).toContain('1 repo<');
  });

  it('greys included=0 rows but keeps them selectable (Decision 7)', () => {
    const block = rowBlock(render(DashboardPage(fixtureProps())), 103);
    expect(block).toContain('text-faint');
    expect(block).toContain('data-repo-select');
  });

  it('marks the first repo across all groups as selected', () => {
    const html = render(DashboardPage(fixtureProps()));
    expect(rowBlock(html, 101)).toContain('bg-panel');
    expect(rowBlock(html, 101)).toContain('font-semibold');
    expect(rowBlock(html, 102)).not.toContain('bg-panel');
  });

  it('renders an empty account group as header plus a muted `no repos selected` row', () => {
    const accounts = [
      fixtureAccount(),
      fixtureAccount({
        installationId: 7,
        accountLogin: 'acme-labs',
        accountType: 'Organization',
        repos: [],
      }),
    ];
    const html = render(DashboardPage(fixtureProps({ accounts })));
    expect(html).toContain('acme-labs');
    expect(html).toContain('no repos selected');
    expect(html).toContain('0 repos');
    // The gear is the fix path, so it must still render for an empty group.
    expect(html).toContain(
      'href="https://github.com/organizations/acme-labs/settings/installations/7"',
    );
  });

  it('renders the install-new-account link with safe new-tab attrs', () => {
    const html = render(DashboardPage(fixtureProps()));
    expect(html).toContain('install new account');
    // The real app slug is gitcert-app, not the comp's `gitcert`.
    expect(html).toContain('href="https://github.com/apps/gitcert-app/installations/new"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener"');
    expect(html).not.toContain('https://github.com/apps/gitcert/installations/new');
  });

  it('drops the global refresh button in favour of per-repo sync icons (D3)', () => {
    const html = render(DashboardPage(fixtureProps()));
    expect(html).not.toContain('id="gc-refresh"');
    expect(html).not.toContain('refresh now');
    expect(html).not.toContain('gc-refresh-note');
  });
});

describe('DashboardPage — per-repo state', () => {
  it('renders a bare relative timestamp with a full-stamp tooltip', () => {
    const block = rowBlock(render(DashboardPage(fixtureProps())), 101);
    expect(block).toContain('2m ago');
    expect(block).toContain('title="Last synced ');
    expect(block).toContain(' UTC"');
    // Bare text — no "last synced" prefix leaks into the visible label.
    expect(block).not.toContain('>Last synced');
  });

  it('colors a stale repo with the --stale token, never a hardcoded hex', () => {
    const html = render(DashboardPage(fixtureProps()));
    const block = rowBlock(html, 102);
    expect(block).toContain('2d ago');
    expect(block).toContain('text-stale');
    expect(html).not.toContain('#b57614');
    expect(html).not.toContain('#e3b341');
  });

  it('renders a fresh repo in the muted (non-stale) color', () => {
    const block = rowBlock(render(DashboardPage(fixtureProps())), 101);
    expect(block).not.toContain('text-stale');
  });

  it('renders `collecting…` and pulses when there is no stats row yet', () => {
    const block = rowBlock(render(DashboardPage(fixtureProps())), 201);
    expect(block).toContain('collecting…');
    expect(block).toContain('data-gc-pulse');
    expect(block).toContain('text-muted');
    // No timestamp and therefore no tooltip.
    expect(block).not.toContain('title="Last synced ');
  });

  it('renders `excluded` in place of the timestamp and hides the sync icon', () => {
    const block = rowBlock(render(DashboardPage(fixtureProps())), 103);
    expect(block).toContain('excluded');
    expect(block).not.toContain('ago<');
    expect(block).toContain('hidden');
    // The live label is carried so the toggle can restore it without JS clocks.
    expect(block).toContain('data-live-text');
    expect(block).toContain('data-live-class');
  });
});

describe('DashboardPage — badge builder', () => {
  it('renders the eight real metric slugs labeled via metricLabel (Decision 5)', () => {
    const html = render(DashboardPage(fixtureProps()));
    expect(html).toContain('<option value="commits">commits</option>');
    expect(html).toContain('<option value="last-commit">last commit</option>');
    expect(html).toContain('<option value="issues">open issues</option>');
    expect(html).toContain('<option value="open-prs">open PRs</option>');
    expect(html).toContain('<option value="language">language</option>');
    expect(html).toContain('<option value="created">created</option>');
    expect(html).toContain('<option value="first-commit">first commit</option>');
    expect(html).toContain('<option value="size">size</option>');
    expect(html).not.toContain('closed-issues');
    expect(html).not.toContain('merged-prs');
  });

  it('renders style segmented control, theme select, and enable toggle on', () => {
    const html = render(DashboardPage(fixtureProps()));
    expect(html).toContain('data-style="flat"');
    expect(html).toContain('data-style="pill"');
    expect(html).toContain('<option value="auto">auto</option>');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('bg-accent');
  });

  it('previews the selected repo via the live badge route with explicit params', () => {
    const html = render(DashboardPage(fixtureProps()));
    expect(html).toContain('src="/b/wnston/client-platform/commits.svg?style=flat&amp;theme=auto"');
    expect(html).toContain('bg-preview');
    // No client-side badge rendering was ported from the comp.
    expect(html).not.toContain('flatBadge');
    expect(html).not.toContain('pillBadge');
  });

  it('shows the exact md snippet in the pre by default', () => {
    const html = render(DashboardPage(fixtureProps()));
    expect(html).toContain(
      '[![commits](https://gitcert.harborstack.app/b/wnston/client-platform/commits.svg?style=flat&amp;theme=auto)](https://gitcert.harborstack.app/verify/wnston/client-platform)',
    );
  });

  it('uses repo.owner for URLs even when it differs from the group login', () => {
    const accounts = [
      fixtureAccount({
        installationId: 4,
        accountLogin: 'new-org',
        accountType: 'Organization',
        // Mid-transfer: the repo row still carries its pre-transfer owner.
        repos: [fixtureRepo({ id: 401, owner: 'old-owner', name: 'moved' })],
      }),
    ];
    const html = render(DashboardPage(fixtureProps({ accounts })));
    expect(html).toContain('src="/b/old-owner/moved/commits.svg?style=flat&amp;theme=auto"');
    expect(html).toContain('href="https://gitcert.harborstack.app/verify/old-owner/moved"');
    expect(html).not.toContain('/b/new-org/moved/');
  });

  it('disables the copy affordance when the selected repo is excluded', () => {
    const accounts = [fixtureAccount({ repos: [fixtureRepo({ included: false })] })];
    const html = render(DashboardPage(fixtureProps({ accounts })));
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('bg-dot');
    expect(count(html, 'cursor-not-allowed opacity-45')).toBe(4);
    // Preview still points at the live endpoint — it renders not-found itself.
    expect(html).toContain('src="/b/wnston/client-platform/commits.svg?style=flat&amp;theme=auto"');
  });

  it('disables the copy affordance while the selected repo is collecting', () => {
    const accounts = [fixtureAccount({ repos: [fixtureRepo({ collectedAt: null })] })];
    const html = render(DashboardPage(fixtureProps({ accounts })));
    // Included, so the enable toggle stays on…
    expect(html).toContain('aria-pressed="true"');
    // …but there is no attested value to copy yet.
    expect(count(html, 'cursor-not-allowed opacity-45')).toBe(4);
  });

  it('enables the copy affordance for an included repo with stats', () => {
    const html = render(DashboardPage(fixtureProps()));
    expect(html).not.toContain('cursor-not-allowed opacity-45');
  });

  it('renders three copy buttons with static per-breakpoint label spans', () => {
    const html = render(DashboardPage(fixtureProps()));
    expect(html).toContain('data-copy="md"');
    expect(html).toContain('data-copy="html"');
    expect(html).toContain('data-copy="react"');
    expect(count(html, 'data-copy-idle')).toBe(3);
    expect(count(html, 'data-copy-copied')).toBe(3);
    expect(html).toContain('<span class="hidden sm:inline">copy </span>markdown');
    expect(count(html, '<span class="hidden sm:inline">copied </span>✓')).toBe(3);
  });

  it('falls back to a muted builder message when no account has a repo', () => {
    const accounts = [fixtureAccount({ repos: [] })];
    const html = render(DashboardPage(fixtureProps({ accounts })));
    expect(html).toContain('Badge builder');
    expect(html).toContain('No repos selected yet');
    expect(html).not.toContain('id="gc-enable"');
    expect(html).not.toContain('id="gc-preview"');
  });
});

describe('DashboardPage — state block and inline script', () => {
  it('embeds the JSON state block grouped by account, carrying collectedAt', () => {
    const html = render(DashboardPage(fixtureProps()));
    expect(html).toContain('id="gc-state"');
    expect(html).toContain('"accounts"');
    expect(html).toContain('"installationId":7');
    expect(html).toContain('"accountType":"Organization"');
    expect(html).toContain('"id":101');
    expect(html).toContain('"collectedAt":null');
    expect(html).toContain('{OWNER}');
    expect(html).toContain('{METRIC}');
    expect(html).toContain('"badgePath"');
  });

  it('escapes < in the JSON state block (no script breakout)', () => {
    const accounts = [fixtureAccount({ repos: [fixtureRepo({ name: 'a</script><b' })] })];
    const html = render(DashboardPage(fixtureProps({ accounts })));
    expect(html).toContain('a\\u003c/script>\\u003cb');
    const stateStart = html.indexOf('id="gc-state"');
    const stateBlock = html.slice(stateStart, html.indexOf('</script>', stateStart));
    expect(stateBlock).not.toContain('a</script><b');
  });

  it('renders the Verification section: verify link + copy for the selected repo', () => {
    const html = render(DashboardPage(fixtureProps()));
    expect(html).toContain('Verification');
    expect(html).toContain('verify:');
    expect(html).toContain('id="gc-verify-link"');
    expect(html).toContain('href="https://gitcert.harborstack.app/verify/wnston/client-platform"');
    expect(html).toContain('data-verify-label');
    expect(html).toContain('id="gc-verify-copy"');
    expect(html).toContain('"verifyUrl"');
    expect(html).toContain('/verify/{OWNER}/{REPO}');
  });

  it('verify link/copy track the repo via DOM APIs (no user data into JS)', () => {
    const html = render(DashboardPage(fixtureProps()));
    expect(html).toContain('verifyLink.href = fill(tpl.verifyUrl, v)');
    expect(html).toContain("verifyLabel.textContent = v.OWNER + '/' + v.REPO");
    expect(html).toContain('navigator.clipboard.writeText(verifyLink.href)');
  });

  it('gates copying on included AND collected, in one predicate', () => {
    const html = render(DashboardPage(fixtureProps()));
    expect(html).toContain('return !!current.repo.included && !!current.repo.collectedAt;');
    expect(html).toContain('if (!copyable()) return;');
    // The old included-only guard is gone.
    expect(html).not.toContain('if (!current.repo.included) return;');
  });

  it('wires per-repo sync to the refresh route and surfaces no error text', () => {
    const html = render(DashboardPage(fixtureProps()));
    expect(html).toContain("fetch('/repos/' + repo.id + '/refresh', { method: 'POST' })");
    expect(html).toContain("icon.setAttribute('data-gc-spin', '')");
    expect(html).toContain("icon.removeAttribute('data-gc-spin')");
    expect(html).toContain("location.href = '/auth/login'");
    // Non-oracular: a 429/404 just stops spinning.
    expect(html).not.toContain('try again in a few minutes');
    expect(html).not.toContain('rate_limited');
  });

  it('drives copied wording via the data-copied attribute only', () => {
    const html = render(DashboardPage(fixtureProps()));
    expect(html).toContain("btn.setAttribute('data-copied', '')");
    expect(html).toContain("b.removeAttribute('data-copied')");
    expect(html).toContain('setTimeout(resetCopyButtons, 1600)');
    expect(html).not.toContain("textContent = 'copied");
    expect(html).not.toContain('innerWidth');
    expect(html).not.toContain("matchMedia('(max-width");
  });

  it('never interpolates user data into the script (placeholder substitution only)', () => {
    const accounts = [fixtureAccount({ accountLogin: 'evil-org', accountType: 'Organization' })];
    const html = render(DashboardPage(fixtureProps({ login: 'evil"login', accounts })));
    const scriptStart = html.indexOf('(function () {');
    const script = html.slice(scriptStart, html.indexOf('})();', scriptStart));
    expect(script).not.toContain('evil');
    expect(script).not.toContain('wnston');
  });

  it('escapes user-controlled strings in markup', () => {
    const accounts = [
      fixtureAccount({
        accountLogin: '<script>alert(2)</script>',
        repos: [fixtureRepo({ owner: '<script>alert(1)</script>', name: 'a&b"c' })],
      }),
    ];
    const html = render(DashboardPage(fixtureProps({ accounts, login: '<img src=x>' })));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<script>alert(2)</script>');
    expect(html).not.toContain('<img src=x>');
  });
});

describe('DashboardPage responsive breakpoints (mobile comp)', () => {
  it('stacks the two panes at base and restores the [400px_1fr] split at lg', () => {
    const html = render(DashboardPage(fixtureProps()));
    expect(html).toContain('grid-cols-1');
    expect(html).toContain('lg:grid-cols-[400px_1fr]');
    expect(html).toContain('lg:border-r');
    expect(html).toContain('lg:border-b-0');
  });

  it('shortens the repo scroll region at base and restores it at lg', () => {
    const html = render(DashboardPage(fixtureProps()));
    expect(html).toContain('max-h-[196px]');
    expect(html).toContain('lg:max-h-[460px]');
  });

  it('keeps the snippet pre horizontally scrollable (overflow guard)', () => {
    const html = render(DashboardPage(fixtureProps()));
    const preTag = html.slice(html.indexOf('id="gc-snippet"'), html.indexOf('</pre>'));
    expect(preTag).toContain('overflow-x-auto');
  });
});

describe('DashboardPage — empty state', () => {
  it('renders the comp empty state and hides the builder and scripts', () => {
    const html = render(DashboardPage(fixtureProps({ accounts: [] })));
    expect(html).toContain('https://github.com/apps/gitcert-app/installations/new');
    expect(html).toContain('No installations yet');
    expect(html).toContain('Install GitCert on your account or an organization');
    expect(html).toContain('opens the GitHub App install page');
    expect(html).not.toContain('id="gc-state"');
    expect(html).not.toContain('Badge builder');
    expect(html).not.toContain('last sync');
  });
});
