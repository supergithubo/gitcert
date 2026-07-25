/**
 * Dashboard page, rebuilt to the approved comp
 * artifacts/design/handoff/project/Dashboard.dc.html (+ its mobile twin,
 * whose breakpoint deltas land as responsive utilities here). Repos are
 * grouped by installation account: personal accounts carry no label, orgs
 * carry an `org` chip.
 *
 * Near-pure component: the route handler passes typed props; nothing here
 * reads D1 or env. It reads the clock ONCE (`nowIso`) to server-render the
 * relative "2m ago" timestamps — safe because `/dashboard` is `no-store`,
 * so an SSR relative time can never be served from a cache.
 *
 * The inline builder script is the sanctioned client-JS surface (hono rules
 * "dashboard copy buttons"): a constant string with NO interpolated user
 * data — it reads the JSON state block (`<` escaped) and performs dumb
 * placeholder substitution on the snippet templates from ./snippets.
 *
 * Not ported from the comp: its `DCLogic`/React internals, `support.js`,
 * mock data, the client-side `flatBadge()`/`pillBadge()` SVG generators
 * (the preview is the LIVE `/b/...svg` route, which already renders the
 * `not found` and `collecting…` states server-side), its component-level
 * theme toggle (layout.tsx owns theming), and its in-row `●`/`○` inclusion
 * dot (design decision #8 — the builder's enable toggle stays the only
 * inclusion control, so there is exactly one write path).
 */

import { raw } from 'hono/html';
import { formatRelative } from '../badges/format';
import type { Metric } from '../badges/types';
import { metricLabel } from '../badges/value';
import { Layout } from './layout';
import {
  BADGE_PATH_TEMPLATE,
  SNIPPET_BASE_URL,
  SNIPPET_TEMPLATES,
  VERIFY_URL,
  buildSnippets,
  fillSnippetTemplate,
} from './snippets';

/** `installations.account_type` — the two shapes an installation can have. */
export type AccountType = 'User' | 'Organization';

export interface DashboardRepo {
  id: number;
  owner: string;
  name: string;
  private: boolean;
  included: boolean;
  /** `stats.collected_at` (ISO) — null means no stats row yet (collecting). */
  collectedAt: string | null;
}

export interface DashboardAccount {
  installationId: number;
  accountLogin: string;
  accountType: AccountType;
  /** Live repos in this installation; may be empty (nothing selected). */
  repos: DashboardRepo[];
}

export interface DashboardPageProps {
  /** Session login — "Dashboard · @{login}". */
  login: string;
  /** ONLY the session tenant's accounts; ordered (personal first) by the caller. */
  accounts: DashboardAccount[];
  /** MAX(stats.collected_at) across repos, ISO — null if never collected. */
  lastSyncAt: string | null;
}

/** Builder dropdown order (spec Decision 5 — the eight M2 slugs). */
const BUILDER_METRICS: readonly Metric[] = [
  'commits',
  'last-commit',
  'issues',
  'open-prs',
  'language',
  'created',
  'first-commit',
  'size',
];

/**
 * GitHub's install flow for the GitCert app. The comp says slug `gitcert`;
 * the real app slug is `gitcert-app`, so the code wins.
 */
const GITCERT_INSTALL_URL = 'https://github.com/apps/gitcert-app/installations/new';

/**
 * Parity with the badge stale rule (SPEC.md §5): stats older than 24h render
 * amber here and a stale badge there.
 */
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

const LABEL_CLASS = 'font-mono text-[12.5px] text-soft';
const PANEL_HEADING_CLASS = 'font-mono text-[11px] tracking-[1.5px] text-muted uppercase';
const SELECT_CLASS =
  'rounded-[2px] border border-hair-strong bg-field px-[10px] py-[7px] font-mono text-[13px] text-ink';
const SEG_BTN_CLASS = 'cursor-pointer border-none px-4 py-[7px] font-mono text-[12.5px]';
const SEG_ACTIVE = 'bg-ink text-paper';
const SEG_INACTIVE = 'bg-field text-soft';
const COPY_BTN_CLASS =
  'group inline-flex flex-1 min-w-0 items-center justify-center gap-[7px] rounded-[2px] border border-hair-strong bg-card px-2 py-2 font-mono text-[12.5px] text-ink sm:flex-none sm:justify-start sm:px-[15px]';

/** Per-repo row state — one derivation rule, shared by SSR and the script. */
type RepoState = 'excluded' | 'collecting' | 'stale' | 'ok';

/**
 * Builder behavior — constant string, no user-data interpolation. State
 * comes from the #gc-state JSON block; snippet/URL formats come from the
 * templates rendered into it (single source: src/pages/snippets.ts).
 *
 * The row's live (included) label text and color are carried on the row's
 * own data-* attributes, so flipping the enable toggle restores them
 * without re-deriving relative time in the browser.
 */
const DASHBOARD_SCRIPT = `(function () {
  var stateEl = document.getElementById('gc-state');
  if (!stateEl) return;
  var state = JSON.parse(stateEl.textContent);
  var repos = [];
  state.accounts.forEach(function (a) {
    a.repos.forEach(function (r) {
      repos.push(r);
    });
  });
  if (!repos.length) return;
  var tpl = state.templates;
  var metricSel = document.getElementById('gc-metric');
  var themeSel = document.getElementById('gc-theme');
  var styleBtns = Array.prototype.slice.call(document.querySelectorAll('#gc-style button'));
  var enableBtn = document.getElementById('gc-enable');
  var knob = document.getElementById('gc-enable-knob');
  var previewWrap = document.getElementById('gc-preview-wrap');
  var previewImg = document.getElementById('gc-preview');
  var snippetPre = document.getElementById('gc-snippet');
  var verifyLink = document.getElementById('gc-verify-link');
  var verifyLabel = verifyLink ? verifyLink.querySelector('[data-verify-label]') : null;
  var verifyCopy = document.getElementById('gc-verify-copy');
  var copyBtns = Array.prototype.slice.call(document.querySelectorAll('button[data-copy]'));
  var rows = Array.prototype.slice.call(document.querySelectorAll('[data-repo-row]'));
  var syncBtns = Array.prototype.slice.call(document.querySelectorAll('button[data-repo-sync]'));
  var current = { repo: repos[0], style: 'flat', shown: 'md', buster: 0 };
  var copyTimer = null;
  var verifyTimer = null;

  function fill(template, v) {
    return template.replace(/\\{(OWNER|REPO|METRIC|LABEL|STYLE|THEME)\\}/g, function (m, k) {
      return v[k];
    });
  }

  function values() {
    return {
      OWNER: current.repo.owner,
      REPO: current.repo.name,
      METRIC: metricSel.value,
      LABEL: metricSel.options[metricSel.selectedIndex].textContent.trim(),
      STYLE: current.style,
      THEME: themeSel.value,
    };
  }

  function repoById(id) {
    for (var i = 0; i < repos.length; i++) {
      if (repos[i].id === id) return repos[i];
    }
    return null;
  }

  function repoFor(el) {
    return repoById(Number(el.getAttribute('data-repo-id')));
  }

  /**
   * Copy gating (comp lines 423-425): an excluded repo serves the grey
   * "not found" badge and a collecting repo has no attested value yet, so
   * neither has a snippet worth pasting.
   */
  function copyable() {
    return !!current.repo.included && !!current.repo.collectedAt;
  }

  function renderPreview(v) {
    var src = fill(tpl.badgePath, v);
    if (current.buster) src += '&t=' + current.buster;
    previewImg.src = src;
    previewWrap.classList.remove('bg-preview', 'bg-preview-light', 'bg-preview-dark');
    var bg = v.THEME === 'auto' ? 'bg-preview' : v.THEME === 'dark' ? 'bg-preview-dark' : 'bg-preview-light';
    previewWrap.classList.add(bg);
    snippetPre.textContent = fill(tpl[current.shown], v);
  }

  function renderBuilder() {
    var enabled = !!current.repo.included;
    var canCopy = copyable();
    enableBtn.classList.toggle('bg-accent', enabled);
    enableBtn.classList.toggle('bg-dot', !enabled);
    enableBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    knob.classList.toggle('left-4', enabled);
    knob.classList.toggle('left-[2px]', !enabled);
    copyBtns.forEach(function (b) {
      b.classList.toggle('opacity-45', !canCopy);
      b.classList.toggle('cursor-not-allowed', !canCopy);
      b.classList.toggle('cursor-pointer', canCopy);
    });
    if (verifyCopy) {
      verifyCopy.classList.toggle('opacity-45', !canCopy);
      verifyCopy.classList.toggle('cursor-not-allowed', !canCopy);
      verifyCopy.classList.toggle('cursor-pointer', canCopy);
    }
  }

  function renderRowState(row, repo) {
    var label = row.querySelector('[data-repo-state]');
    if (label) {
      label.classList.remove('text-faint', 'text-muted', 'text-stale');
      if (repo.included) {
        label.textContent = label.getAttribute('data-live-text');
        label.classList.add(label.getAttribute('data-live-class'));
        if (label.hasAttribute('data-live-pulse')) label.setAttribute('data-gc-pulse', '');
      } else {
        label.textContent = 'excluded';
        label.classList.add('text-faint');
        label.removeAttribute('data-gc-pulse');
      }
    }
    var sync = row.querySelector('button[data-repo-sync]');
    if (sync) sync.classList.toggle('hidden', !repo.included);
  }

  function renderRows() {
    rows.forEach(function (row) {
      var repo = repoFor(row);
      if (!repo) return;
      var selected = repo === current.repo;
      row.classList.toggle('bg-panel', selected);
      var name = row.querySelector('[data-repo-name]');
      if (name) {
        name.classList.toggle('font-semibold', selected);
        name.classList.toggle('text-ink', !!repo.included);
        name.classList.toggle('text-faint', !repo.included);
      }
      renderRowState(row, repo);
    });
  }

  function renderVerify(v) {
    if (!verifyLink) return;
    verifyLink.href = fill(tpl.verifyUrl, v);
    if (verifyLabel) verifyLabel.textContent = v.OWNER + '/' + v.REPO;
  }

  function render() {
    var v = values();
    renderPreview(v);
    renderBuilder();
    renderRows();
    renderVerify(v);
  }

  function resetCopyButtons() {
    copyBtns.forEach(function (b) {
      b.removeAttribute('data-copied');
      b.classList.remove('border-accent', 'bg-panel', 'text-accent');
    });
  }

  Array.prototype.slice.call(document.querySelectorAll('button[data-repo-select]')).forEach(function (btn) {
    btn.addEventListener('click', function () {
      var repo = repoFor(btn);
      if (repo) current.repo = repo;
      render();
    });
  });

  metricSel.addEventListener('change', render);
  themeSel.addEventListener('change', render);

  styleBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      current.style = btn.getAttribute('data-style');
      styleBtns.forEach(function (b) {
        var active = b === btn;
        b.classList.toggle('bg-ink', active);
        b.classList.toggle('text-paper', active);
        b.classList.toggle('bg-field', !active);
        b.classList.toggle('text-soft', !active);
      });
      render();
    });
  });

  copyBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!copyable()) return;
      var kind = btn.getAttribute('data-copy');
      current.shown = kind;
      var text = fill(tpl[kind], values());
      try {
        if (navigator.clipboard) navigator.clipboard.writeText(text);
      } catch (e) {}
      render();
      resetCopyButtons();
      btn.setAttribute('data-copied', '');
      btn.classList.add('border-accent', 'bg-panel', 'text-accent');
      clearTimeout(copyTimer);
      copyTimer = setTimeout(resetCopyButtons, 1600);
    });
  });

  if (verifyCopy) {
    verifyCopy.addEventListener('click', function () {
      if (!copyable()) return;
      try {
        if (navigator.clipboard) navigator.clipboard.writeText(verifyLink.href);
      } catch (e) {}
      verifyCopy.setAttribute('data-copied', '');
      verifyCopy.classList.add('border-accent', 'bg-panel', 'text-accent');
      clearTimeout(verifyTimer);
      verifyTimer = setTimeout(function () {
        verifyCopy.removeAttribute('data-copied');
        verifyCopy.classList.remove('border-accent', 'bg-panel', 'text-accent');
      }, 1600);
    });
  }

  enableBtn.addEventListener('click', function () {
    var repo = current.repo;
    var next = !repo.included;
    repo.included = next;
    render();
    fetch('/repos/' + repo.id + '/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ included: next }),
    })
      .then(function (res) {
        if (res.status === 401) {
          location.href = '/auth/login';
          return;
        }
        if (!res.ok) throw new Error('settings');
        current.buster = Date.now();
        render();
      })
      .catch(function () {
        repo.included = !next;
        render();
      });
  });

  /**
   * Per-repo sync. The route answers uniformly (202 / 429 / 404) and this
   * surfaces no error text either way — a rate-limited or unknown repo just
   * stops spinning, so nothing here is an oracle.
   */
  syncBtns.forEach(function (btn) {
    var icon = btn.querySelector('svg');
    btn.addEventListener('click', function () {
      if (btn.disabled) return;
      var repo = repoFor(btn);
      if (!repo) return;
      btn.disabled = true;
      if (icon) icon.setAttribute('data-gc-spin', '');
      function stop() {
        btn.disabled = false;
        if (icon) icon.removeAttribute('data-gc-spin');
      }
      fetch('/repos/' + repo.id + '/refresh', { method: 'POST' })
        .then(function (res) {
          if (res.status === 401) {
            location.href = '/auth/login';
            return;
          }
          if (res.status === 202 && repo === current.repo) {
            current.buster = Date.now();
            render();
          }
          stop();
        })
        .catch(stop);
    });
  });
})();`;

export function DashboardPage(props: DashboardPageProps) {
  const { login, accounts, lastSyncAt } = props;
  // Single clock read; `/dashboard` is no-store so SSR relative time is safe.
  const nowIso = new Date().toISOString();
  const selected = accounts.flatMap((a) => a.repos)[0];
  return (
    <Layout title="GitCert — dashboard" account={{ handle: login }}>
      <div class="mx-auto max-w-[1120px] px-4 pt-8 pb-16 sm:px-7 sm:pt-[52px] sm:pb-24">
        <div class="font-mono text-[11px] tracking-[2px] text-muted uppercase">
          Dashboard · @{login}
        </div>
        <h1 class="mt-[10px] mb-6 text-[24px] font-medium tracking-[-0.4px] sm:mb-[30px] sm:text-[30px]">
          Attest a repo, get a badge
        </h1>
        {accounts.length === 0 ? (
          <EmptyState />
        ) : (
          <DashboardCard
            accounts={accounts}
            selected={selected}
            lastSyncAt={lastSyncAt}
            nowIso={nowIso}
          />
        )}
      </div>
    </Layout>
  );
}

/** No installations at all (comp `isEmpty` branch, lines 86-96). */
function EmptyState() {
  return (
    <div class="border border-hair-strong bg-card">
      <div class="flex min-h-[320px] items-center justify-center px-6 py-[52px] sm:min-h-[400px] sm:px-10 sm:py-[72px]">
        <div class="flex w-full max-w-[340px] flex-col items-center text-center sm:max-w-[460px]">
          <SealIcon />
          <div class="mb-3 font-mono text-[10.5px] tracking-[2px] text-muted uppercase sm:mb-[14px] sm:text-[11px]">
            No installations yet
          </div>
          <p class="m-0 mb-[22px] text-[17px] leading-[1.5] font-medium tracking-[-0.2px] text-ink text-pretty sm:mb-[26px] sm:text-[19px]">
            Install GitCert on your account or an organization to start attesting repos.
          </p>
          <a
            data-nav
            href={GITCERT_INSTALL_URL}
            target="_blank"
            rel="noopener"
            class="inline-flex items-center gap-2 rounded-[2px] bg-accent px-5 py-3 font-mono text-[13px] text-white sm:px-[22px] sm:text-[13.5px]"
          >
            <span class="sm:hidden">Install on GitHub →</span>
            <span class="hidden sm:inline">Install GitCert on GitHub →</span>
          </a>
          <div class="mt-[14px] font-mono text-[10.5px] text-faint sm:mt-4 sm:text-[11px]">
            opens the GitHub App install page
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardCard(props: {
  accounts: DashboardAccount[];
  selected: DashboardRepo | undefined;
  lastSyncAt: string | null;
  nowIso: string;
}) {
  const { accounts, selected, lastSyncAt, nowIso } = props;
  // Grouped exactly as rendered, so the script re-derives builder state on
  // selection change with no round-trip (spec Step 8).
  const state = {
    accounts: accounts.map((a) => ({
      installationId: a.installationId,
      accountLogin: a.accountLogin,
      accountType: a.accountType,
      repos: a.repos.map((r) => ({
        id: r.id,
        owner: r.owner,
        name: r.name,
        included: r.included,
        collectedAt: r.collectedAt,
      })),
    })),
    templates: { ...SNIPPET_TEMPLATES, badgePath: BADGE_PATH_TEMPLATE, verifyUrl: VERIFY_URL },
  };
  const stateJson = JSON.stringify(state).replace(/</g, '\\u003c');
  return (
    <div class="grid grid-cols-1 border border-hair-strong bg-card lg:grid-cols-[400px_1fr]">
      <AccountPanel
        accounts={accounts}
        selected={selected}
        lastSyncAt={lastSyncAt}
        nowIso={nowIso}
      />
      {selected === undefined ? <NoSelectionPanel /> : <BuilderPanel selected={selected} />}
      <script type="application/json" id="gc-state">
        {raw(stateJson)}
      </script>
      <script>{raw(DASHBOARD_SCRIPT)}</script>
    </div>
  );
}

function AccountPanel(props: {
  accounts: DashboardAccount[];
  selected: DashboardRepo | undefined;
  lastSyncAt: string | null;
  nowIso: string;
}) {
  const { accounts, selected, lastSyncAt, nowIso } = props;
  return (
    <div class="border-b border-hair p-5 lg:border-r lg:border-b-0 lg:p-6">
      <div class={`${PANEL_HEADING_CLASS} mb-4`}>Accounts</div>
      <div
        data-repo-scroll
        class="-mx-3 max-h-[196px] overflow-x-hidden overflow-y-auto px-3 lg:max-h-[460px]"
      >
        {accounts.map((account, index) => (
          <AccountGroup account={account} selected={selected} nowIso={nowIso} first={index === 0} />
        ))}
      </div>
      <div class="my-[18px] h-px bg-hair2" />
      <div class="flex flex-wrap gap-2">
        {/* Link styled as the secondary button (data-nav: no hover underline;
            text-accent per the comp) — GitHub's own install flow adds the
            next account, no JS here. */}
        <a
          data-nav
          href={GITCERT_INSTALL_URL}
          target="_blank"
          rel="noopener"
          class="rounded-[2px] border border-hair-strong bg-transparent px-[14px] py-2 font-mono text-[12.5px] whitespace-nowrap text-accent"
        >
          install new account
        </a>
      </div>
      <div class="mt-3 font-mono text-[11px] text-muted">
        last sync {lastSyncAt === null ? '—' : formatUtcStamp(lastSyncAt)}
      </div>
    </div>
  );
}

/** One installation: header (login + `org` chip + count + gear) then rows. */
function AccountGroup(props: {
  account: DashboardAccount;
  selected: DashboardRepo | undefined;
  nowIso: string;
  first: boolean;
}) {
  const { account, selected, nowIso, first } = props;
  const count = account.repos.length;
  return (
    <div class={first ? '' : 'mt-[6px] border-t border-hair2 pt-[14px]'}>
      <div class="flex items-baseline justify-between gap-[10px] px-2 pb-[9px]">
        <span class="flex min-w-0 items-baseline gap-2">
          <span class="truncate font-mono text-[12.5px] font-semibold tracking-[-0.2px] text-ink">
            {account.accountLogin}
          </span>
          {/* Personal accounts carry NO label (comp line 406). */}
          {account.accountType === 'Organization' ? (
            <span class="inline-block flex-none rounded-[2px] border border-hair-strong px-[5px] py-[2px] font-mono text-[9.5px] tracking-[0.6px] whitespace-nowrap text-muted uppercase">
              org
            </span>
          ) : null}
        </span>
        <span class="flex flex-none items-center gap-2">
          <span class="font-mono text-[10px] whitespace-nowrap text-muted">
            {count} {count === 1 ? 'repo' : 'repos'}
          </span>
          <a
            data-nav
            href={manageInstallationUrl(account)}
            target="_blank"
            rel="noopener"
            title="Manage repos on GitHub"
            aria-label="Manage repos on GitHub"
            class="inline-flex items-center justify-center p-[2px] text-faint hover:text-accent"
          >
            <GearIcon />
          </a>
        </span>
      </div>
      {count === 0 ? (
        <div class="px-[14px] py-[11px] font-mono text-[12px] text-faint">no repos selected</div>
      ) : (
        account.repos.map((repo) => (
          <RepoRow repo={repo} selected={repo === selected} nowIso={nowIso} />
        ))
      )}
    </div>
  );
}

function RepoRow(props: { repo: DashboardRepo; selected: boolean; nowIso: string }) {
  const { repo, selected, nowIso } = props;
  return (
    <div
      data-repo-row
      data-repo-id={repo.id}
      class={`-mx-[6px] flex items-center gap-[10px] rounded-[3px] px-[14px] py-[11px] ${
        selected ? 'bg-panel' : ''
      }`}
    >
      <button
        type="button"
        data-repo-select
        data-repo-id={repo.id}
        class="flex min-w-0 flex-initial cursor-pointer items-center border-none bg-transparent p-0 text-left"
      >
        <span
          data-repo-name
          class={`inline-flex min-w-0 items-center gap-2 overflow-hidden font-mono text-[13px] ${
            repo.included ? 'text-ink' : 'text-faint'
          }${selected ? ' font-semibold' : ''}`}
        >
          <GithubRepoIcon />
          {/* Short name per the comp; every URL below uses owner + name. */}
          <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{repo.name}</span>
        </span>
      </button>
      <RepoStateLabel repo={repo} nowIso={nowIso} />
      <button
        type="button"
        data-repo-sync
        data-repo-id={repo.id}
        title="sync"
        aria-label="sync"
        class={`inline-flex flex-none cursor-pointer items-center justify-center border-none bg-transparent p-[2px] text-faint hover:text-accent ${
          repo.included ? '' : 'hidden'
        }`}
      >
        <SyncIcon />
      </button>
    </div>
  );
}

/**
 * The row's freshness cell. `data-live-*` carries what the label reads when
 * the repo is included, so the enable toggle can restore it client-side
 * without recomputing relative time.
 */
function RepoStateLabel(props: { repo: DashboardRepo; nowIso: string }) {
  const { repo, nowIso } = props;
  const live = repoState({ ...repo, included: true }, nowIso);
  const liveText = live === 'collecting' ? 'collecting…' : formatRelative(repo.collectedAt, nowIso);
  const liveClass = STATE_CLASS[live];
  const excluded = !repo.included;
  return (
    <span
      data-repo-state
      data-live-text={liveText}
      data-live-class={liveClass}
      data-live-pulse={live === 'collecting' ? '1' : undefined}
      data-gc-pulse={!excluded && live === 'collecting' ? '' : undefined}
      title={
        repo.collectedAt === null ? undefined : `Last synced ${formatUtcStamp(repo.collectedAt)}`
      }
      class={`ml-auto font-mono text-[10px] whitespace-nowrap ${
        excluded ? STATE_CLASS.excluded : liveClass
      }`}
    >
      {excluded ? 'excluded' : liveText}
    </span>
  );
}

/** Row label colors (comp lines 388-391); stale uses the `--stale` token. */
const STATE_CLASS: Record<RepoState, string> = {
  excluded: 'text-faint',
  collecting: 'text-muted',
  stale: 'text-stale',
  ok: 'text-faint',
};

/** The single state rule, mirrored by `copyable()` in DASHBOARD_SCRIPT. */
function repoState(repo: DashboardRepo, nowIso: string): RepoState {
  if (!repo.included) return 'excluded';
  if (repo.collectedAt === null) return 'collecting';
  const age = Date.parse(nowIso) - Date.parse(repo.collectedAt);
  return age > STALE_THRESHOLD_MS ? 'stale' : 'ok';
}

/**
 * Per-account deep link into GitHub's repo picker. The comp hardcodes the
 * generic `/settings/installations` for every group, which 404s for an org
 * — orgs live under their own settings path.
 */
function manageInstallationUrl(account: DashboardAccount): string {
  if (account.accountType === 'Organization') {
    const login = encodeURIComponent(account.accountLogin);
    return `https://github.com/organizations/${login}/settings/installations/${account.installationId}`;
  }
  return `https://github.com/settings/installations/${account.installationId}`;
}

/** Accounts exist but none has a selected repo — nothing to build yet. */
function NoSelectionPanel() {
  return (
    <div class="p-5 sm:px-7 sm:py-6">
      <div class={`${PANEL_HEADING_CLASS} mb-5`}>Badge builder</div>
      <div class="font-mono text-[13px] text-muted">
        No repos selected yet — use <span class="text-soft">Manage repos on GitHub</span> to pick
        the repos GitCert may attest.
      </div>
    </div>
  );
}

function BuilderPanel(props: { selected: DashboardRepo }) {
  const { selected } = props;
  const enabled = selected.included;
  // Excluded → grey "not found" badge; collecting → no attested value yet.
  const copyable = enabled && selected.collectedAt !== null;
  const initial = {
    owner: selected.owner,
    repo: selected.name,
    metric: 'commits' as Metric,
    label: metricLabel('commits'),
    style: 'flat' as const,
    theme: 'auto' as const,
  };
  const previewSrc = fillSnippetTemplate(BADGE_PATH_TEMPLATE, initial);
  const snippets = buildSnippets(initial);
  return (
    <div class="p-5 sm:px-7 sm:py-6">
      <div class={`${PANEL_HEADING_CLASS} mb-5`}>Badge builder</div>

      <div class="grid max-w-[420px] grid-cols-[70px_1fr] items-center gap-x-4 gap-y-[18px]">
        <label class={LABEL_CLASS}>enable</label>
        <button
          type="button"
          id="gc-enable"
          aria-pressed={enabled ? 'true' : 'false'}
          class={`relative h-5 w-[34px] cursor-pointer rounded-full border-none p-0 transition-colors duration-[180ms] ${
            enabled ? 'bg-accent' : 'bg-dot'
          }`}
        >
          <span
            id="gc-enable-knob"
            class={`absolute top-[2px] h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-[left] duration-[180ms] ${
              enabled ? 'left-4' : 'left-[2px]'
            }`}
          />
        </button>

        <label class={LABEL_CLASS} for="gc-metric">
          metric
        </label>
        <select id="gc-metric" class={SELECT_CLASS}>
          {BUILDER_METRICS.map((m) => (
            <option value={m}>{metricLabel(m)}</option>
          ))}
        </select>

        <label class={LABEL_CLASS}>style</label>
        <div
          id="gc-style"
          class="inline-flex w-fit overflow-hidden rounded-[2px] border border-hair-strong"
        >
          <button type="button" data-style="flat" class={`${SEG_BTN_CLASS} ${SEG_ACTIVE}`}>
            flat
          </button>
          <button type="button" data-style="pill" class={`${SEG_BTN_CLASS} ${SEG_INACTIVE}`}>
            pill
          </button>
        </div>

        <label class={LABEL_CLASS} for="gc-theme">
          theme
        </label>
        <select id="gc-theme" class={`${SELECT_CLASS} w-fit`}>
          <option value="auto">auto</option>
          <option value="light">light</option>
          <option value="dark">dark</option>
        </select>
      </div>

      <div class={`${PANEL_HEADING_CLASS} mt-7 mb-2`}>Preview</div>
      {/* Live badge route: it already serves `not found` for an excluded repo
          and `collecting…` when there is no stats row — no client-side badge
          rendering, and no existence oracle. */}
      <div
        id="gc-preview-wrap"
        class="flex items-center justify-start rounded-[3px] border border-hair2 bg-preview p-[26px]"
      >
        <span class="inline-flex">
          <img id="gc-preview" src={previewSrc} alt="badge preview" />
        </span>
      </div>

      <div class="mt-6 flex gap-[7px] sm:flex-wrap sm:gap-[9px]">
        <CopyButton kind="md" label="markdown" enabled={copyable} />
        <CopyButton kind="html" label="html" enabled={copyable} />
        <CopyButton kind="react" label="react" enabled={copyable} />
      </div>
      <pre
        id="gc-snippet"
        class="mt-[18px] overflow-x-auto rounded-[3px] border border-hair2 bg-panel2 px-4 py-[14px] font-mono text-[12px] leading-[1.5] break-all whitespace-pre-wrap text-body"
      >
        {snippets.md}
      </pre>

      <div class={`${PANEL_HEADING_CLASS} mt-7 mb-2`}>Verification</div>
      {/* verify link + copy target track the selected repo; the inline script
          sets .href and the label's textContent (DOM APIs, no HTML injection). */}
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[13px]">
        <span class="text-muted">verify:</span>
        <a
          id="gc-verify-link"
          data-nav
          href={`${SNIPPET_BASE_URL}/verify/${initial.owner}/${initial.repo}`}
          target="_blank"
          rel="noopener"
          class="text-accent"
        >
          <span data-verify-label>
            {initial.owner}/{initial.repo}
          </span>{' '}
          ↗
        </a>
        <button
          type="button"
          id="gc-verify-copy"
          aria-label="copy verify URL"
          class={`inline-flex items-center rounded-[2px] border border-hair-strong bg-transparent p-[7px] text-soft ${
            copyable ? 'cursor-pointer' : 'cursor-not-allowed opacity-45'
          }`}
        >
          <CopyIcon />
        </button>
      </div>
    </div>
  );
}

/**
 * Copy-trigger button. Wording per breakpoint is static markup (comp:
 * `markdown` / `✓` on mobile, `copy markdown` / `copied ✓` from `sm:`) —
 * the script only toggles the button's `data-copied` attribute; CSS
 * (`group-data-copied:` variants) swaps the idle/copied spans. This is the
 * sanctioned DASHBOARD_SCRIPT deviation from the spec: no viewport logic
 * ever enters JS.
 */
function CopyButton(props: { kind: 'md' | 'html' | 'react'; label: string; enabled: boolean }) {
  const { kind, label, enabled } = props;
  return (
    <button
      type="button"
      data-copy={kind}
      class={`${COPY_BTN_CLASS} ${enabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-45'}`}
    >
      <CopyIcon />
      <span data-copy-idle class="group-data-copied:hidden">
        <span class="hidden sm:inline">copy </span>
        {label}
      </span>
      <span data-copy-copied class="hidden group-data-copied:inline">
        <span class="hidden sm:inline">copied </span>✓
      </span>
    </button>
  );
}

/** GitHub repo glyph from the comp's repo rows (animation attrs not ported). */
function GithubRepoIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="flex-none"
    >
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  );
}

/** Per-account "Manage repos on GitHub" glyph (comp line 110). */
function GearIcon() {
  return (
    <svg
      data-gear
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="block size-[14px] lg:size-[13px]"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Per-repo refresh glyph (comp line 119). */
function SyncIcon() {
  return (
    <svg
      data-sync
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="block size-[13px] lg:size-[12px]"
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

/** Seal glyph for the empty state (comp line 89). */
function SealIcon() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--accent)"
      stroke-width="1.6"
      class="mb-5 block sm:mb-[22px] sm:size-[34px]"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

/** Copy glyph from the comp's copy buttons. */
function CopyIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="flex-none"
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

/** `YYYY-MM-DD HH:MM UTC` — the row tooltip and the last-sync line. */
function formatUtcStamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}
