import { describe, expect, it } from 'vitest';
import {
  DashboardPage,
  type DashboardPageProps,
  type DashboardRepo,
} from '../../src/pages/dashboard';

function fixtureRepo(overrides: Partial<DashboardRepo> = {}): DashboardRepo {
  return {
    id: 101,
    owner: 'wnston',
    name: 'client-platform',
    private: true,
    included: true,
    ...overrides,
  };
}

function fixtureProps(overrides: Partial<DashboardPageProps> = {}): DashboardPageProps {
  return {
    login: 'wnston',
    repos: [
      fixtureRepo(),
      fixtureRepo({ id: 102, name: 'open-cli', private: false }),
      fixtureRepo({ id: 103, name: 'paused-repo', included: false }),
    ],
    lastSyncAt: '2026-07-22T14:03:00Z',
    ...overrides,
  };
}

function render(node: unknown): string {
  return String(node);
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe('DashboardPage — header and repo list', () => {
  it('renders the eyebrow, h1, and shell', () => {
    const html = render(DashboardPage(fixtureProps()));
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Dashboard · @wnston');
    expect(html).toContain('Attest a repo, get a badge');
    expect(html).toContain('My repos');
  });

  it('renders every repo row with owner/name and private/public tags', () => {
    const html = render(DashboardPage(fixtureProps()));
    expect(html).toContain('wnston/client-platform');
    expect(html).toContain('wnston/open-cli');
    expect(html).toContain('wnston/paused-repo');
    expect(html).toContain('private');
    expect(html).toContain('public');
    expect(html).toContain('data-repo-id="101"');
    expect(html).toContain('data-repo-id="103"');
  });

  it('greys included=0 rows but keeps them as selectable buttons (Decision 7)', () => {
    const html = render(DashboardPage(fixtureProps()));
    const pausedRow = html.slice(html.indexOf('data-repo-id="103"'), html.indexOf('paused-repo'));
    expect(pausedRow).toContain('text-faint');
    expect(pausedRow).not.toContain('text-ink');
    // Row is a button — the list has no per-row include toggles (decision #8).
    expect(html).not.toContain('●');
    expect(html).not.toContain('○');
  });

  it('marks the first repo as selected (panel background, weight 600)', () => {
    const html = render(DashboardPage(fixtureProps()));
    const firstRow = html.slice(
      html.indexOf('data-repo-id="101"'),
      html.indexOf('client-platform'),
    );
    expect(firstRow).toContain('bg-panel');
    expect(firstRow).toContain('font-semibold');
    const secondRow = html.slice(html.indexOf('data-repo-id="102"'), html.indexOf('open-cli'));
    expect(secondRow).not.toContain('bg-panel');
  });

  it('renders last sync HH:MM UTC from lastSyncAt', () => {
    const html = render(DashboardPage(fixtureProps()));
    expect(html).toContain('last sync 14:03 UTC');
  });

  it('renders an em-dash when lastSyncAt is null', () => {
    const html = render(DashboardPage(fixtureProps({ lastSyncAt: null })));
    expect(html).toContain('last sync — UTC');
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
    expect(html).not.toContain('open-issues');
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

  it('previews the selected repo via a relative badge URL with explicit params', () => {
    const html = render(DashboardPage(fixtureProps()));
    expect(html).toContain('src="/b/wnston/client-platform/commits.svg?style=flat&amp;theme=auto"');
    expect(html).toContain('bg-preview');
  });

  it('shows the exact md snippet in the pre by default', () => {
    const html = render(DashboardPage(fixtureProps()));
    expect(html).toContain(
      '[![commits](https://gitcert.harborstack.app/b/wnston/client-platform/commits.svg?style=flat&amp;theme=auto)](https://gitcert.harborstack.app/verify/wnston/client-platform)',
    );
  });

  it('starts the builder disabled when the selected repo is excluded (decision #7)', () => {
    const repos = [fixtureRepo({ included: false })];
    const html = render(DashboardPage(fixtureProps({ repos })));
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('bg-dot');
    expect(html).toContain('opacity-45');
    expect(html).toContain('cursor-not-allowed');
    // Preview still points at the live endpoint — it renders the not-found badge itself.
    expect(html).toContain('src="/b/wnston/client-platform/commits.svg?style=flat&amp;theme=auto"');
  });

  it('renders three copy buttons with static per-breakpoint label spans', () => {
    const html = render(DashboardPage(fixtureProps()));
    expect(html).toContain('data-copy="md"');
    expect(html).toContain('data-copy="html"');
    expect(html).toContain('data-copy="react"');
    // Two static label spans per button (6 total) — CSS picks the wording.
    expect(count(html, 'data-copy-idle')).toBe(3);
    expect(count(html, 'data-copy-copied')).toBe(3);
    expect(html).toContain('<span class="hidden sm:inline">copy </span>markdown');
    expect(html).toContain('<span class="hidden sm:inline">copy </span>html');
    expect(html).toContain('<span class="hidden sm:inline">copy </span>react');
    expect(count(html, '<span class="hidden sm:inline">copied </span>✓')).toBe(3);
    // The old single-span shape (script-swapped textContent) is gone.
    expect(html).not.toContain('data-copy-label');
    expect(html).not.toContain('>copy markdown<');
  });
});

describe('DashboardPage — state block and inline script', () => {
  it('embeds the JSON state block with repos and placeholder templates', () => {
    const html = render(DashboardPage(fixtureProps()));
    expect(html).toContain('id="gc-state"');
    expect(html).toContain('"id":101');
    expect(html).toContain('{OWNER}');
    expect(html).toContain('{METRIC}');
    expect(html).toContain('"badgePath"');
  });

  it('escapes < in the JSON state block (no script breakout)', () => {
    const repos = [fixtureRepo({ name: 'a</script><b' })];
    const html = render(DashboardPage(fixtureProps({ repos })));
    expect(html).toContain('a\\u003c/script>\\u003cb');
    const stateStart = html.indexOf('id="gc-state"');
    const stateBlock = html.slice(stateStart, html.indexOf('</script>', stateStart));
    // The raw (unescaped) repo name never reaches the block.
    expect(stateBlock).not.toContain('a</script><b');
  });

  it('includes the constant builder script wired to the owner routes', () => {
    const html = render(DashboardPage(fixtureProps()));
    expect(html).toContain('/settings');
    expect(html).toContain('/refresh');
    expect(html).toContain("location.href = '/auth/login'");
    expect(html).toContain('try again in a few minutes');
    expect(html).toContain('navigator.clipboard');
  });

  it('drives copied wording via the data-copied attribute only (sanctioned deviation)', () => {
    const html = render(DashboardPage(fixtureProps()));
    // On copy: set the attribute; on reset: remove it — no textContent writes.
    expect(html).toContain("btn.setAttribute('data-copied', '')");
    expect(html).toContain("b.removeAttribute('data-copied')");
    expect(html).toContain('setTimeout(resetCopyButtons, 1600)');
    expect(html).not.toContain('data-label-default');
    expect(html).not.toContain("textContent = 'copied");
    // Pure-CSS responsiveness: the script never reads the viewport.
    expect(html).not.toContain('innerWidth');
    expect(html).not.toContain("matchMedia('(max-width");
  });

  it('never interpolates user data into the script (placeholder substitution only)', () => {
    const html = render(DashboardPage(fixtureProps({ login: 'evil"login' })));
    const scriptStart = html.indexOf('(function () {');
    const script = html.slice(scriptStart, html.indexOf('})();', scriptStart));
    expect(script).not.toContain('evil');
    expect(script).not.toContain('wnston');
  });

  it('escapes user-controlled strings in markup', () => {
    const repos = [fixtureRepo({ owner: '<script>alert(1)</script>', name: 'a&b"c' })];
    const html = render(DashboardPage(fixtureProps({ repos, login: '<img src=x>' })));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x>');
  });
});

describe('DashboardPage responsive breakpoints (mobile spec)', () => {
  it('stacks the two panes at base and restores the [400px_1fr] split at lg', () => {
    const html = render(DashboardPage(fixtureProps()));
    expect(html).toContain('grid-cols-1');
    expect(html).toContain('lg:grid-cols-[400px_1fr]');
    // Repo panel border swaps from bottom (stacked) to right (split).
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
  it('renders the install link and hides refresh, builder, and scripts', () => {
    const html = render(DashboardPage(fixtureProps({ repos: [], lastSyncAt: null })));
    expect(html).toContain('https://github.com/apps/gitcert/installations/new');
    expect(html).toContain('No repos yet');
    expect(html).not.toContain('id="gc-refresh"');
    expect(html).not.toContain('id="gc-state"');
    expect(html).not.toContain('Badge builder');
    expect(html).not.toContain('last sync');
  });
});
