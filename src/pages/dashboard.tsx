/**
 * Dashboard page (M3 spec §Frozen Interface), ported from
 * artifacts/design/dashboard.dc.html. Pure component: the route handler
 * passes typed props; nothing here reads D1, env, or the clock. The inline
 * builder script is the sanctioned client-JS surface (hono rules
 * "dashboard copy buttons"): a constant string with NO interpolated user
 * data — it reads the JSON state block (`<` escaped) and performs dumb
 * placeholder substitution on the snippet templates from ./snippets.
 *
 * Not ported from the mock (spec §Dashboard "Do not port"): in-list
 * toggle dots (design decision #8 — the builder's enable toggle is the
 * only inclusion control), theme-toggle button, design-tool runtime,
 * vestigial metrics. Greyed `included=0` rows remain selectable
 * (spec Decision 7).
 */

import { raw } from 'hono/html';
import type { Metric } from '../badges/types';
import { metricLabel } from '../badges/value';
import { Layout } from './layout';
import {
  BADGE_PATH_TEMPLATE,
  SNIPPET_TEMPLATES,
  buildSnippets,
  fillSnippetTemplate,
} from './snippets';

export interface DashboardRepo {
  id: number;
  owner: string;
  name: string;
  private: boolean;
  included: boolean;
}

export interface DashboardPageProps {
  /** Session login — "Dashboard · @{login}". */
  login: string;
  /** ONLY the session tenant's repos; sorted (owner, name) by the caller. */
  repos: DashboardRepo[];
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

const LABEL_CLASS = 'font-mono text-[12.5px] text-soft';
const PANEL_HEADING_CLASS = 'font-mono text-[11px] tracking-[1.5px] text-muted uppercase';
const SELECT_CLASS =
  'rounded-[2px] border border-hair-strong bg-field px-[10px] py-[7px] font-mono text-[13px] text-ink';
const SEG_BTN_CLASS = 'cursor-pointer border-none px-4 py-[7px] font-mono text-[12.5px]';
const SEG_ACTIVE = 'bg-ink text-paper';
const SEG_INACTIVE = 'bg-field text-soft';
const COPY_BTN_CLASS =
  'inline-flex items-center gap-[7px] rounded-[2px] border border-hair-strong bg-card px-[15px] py-2 font-mono text-[12.5px] text-ink';

/**
 * Builder behavior — constant string, no user-data interpolation. State
 * comes from the #gc-state JSON block; snippet/URL formats come from the
 * templates rendered into it (single source: src/pages/snippets.ts).
 */
const DASHBOARD_SCRIPT = `(function () {
  var stateEl = document.getElementById('gc-state');
  if (!stateEl) return;
  var state = JSON.parse(stateEl.textContent);
  var repos = state.repos;
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
  var refreshBtn = document.getElementById('gc-refresh');
  var refreshNote = document.getElementById('gc-refresh-note');
  var copyBtns = Array.prototype.slice.call(document.querySelectorAll('button[data-copy]'));
  var rows = Array.prototype.slice.call(document.querySelectorAll('button[data-repo-id]'));
  var current = { repo: repos[0], style: 'flat', shown: 'md', buster: 0 };
  var copyTimer = null;
  var refreshTimer = null;

  copyBtns.forEach(function (b) {
    b.setAttribute('data-label-default', b.querySelector('[data-copy-label]').textContent);
  });

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

  function repoFor(row) {
    var id = Number(row.getAttribute('data-repo-id'));
    for (var i = 0; i < repos.length; i++) {
      if (repos[i].id === id) return repos[i];
    }
    return null;
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
    enableBtn.classList.toggle('bg-accent', enabled);
    enableBtn.classList.toggle('bg-dot', !enabled);
    enableBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    knob.classList.toggle('left-4', enabled);
    knob.classList.toggle('left-[2px]', !enabled);
    copyBtns.forEach(function (b) {
      b.classList.toggle('opacity-45', !enabled);
      b.classList.toggle('cursor-not-allowed', !enabled);
      b.classList.toggle('cursor-pointer', enabled);
    });
  }

  function renderRows() {
    rows.forEach(function (row) {
      var repo = repoFor(row);
      if (!repo) return;
      var selected = repo === current.repo;
      row.classList.toggle('bg-panel', selected);
      var name = row.querySelector('[data-repo-name]');
      name.classList.toggle('font-semibold', selected);
      name.classList.toggle('text-ink', !!repo.included);
      name.classList.toggle('text-faint', !repo.included);
    });
  }

  function render() {
    renderPreview(values());
    renderBuilder();
    renderRows();
  }

  function resetCopyButtons() {
    copyBtns.forEach(function (b) {
      b.querySelector('[data-copy-label]').textContent = b.getAttribute('data-label-default');
      b.classList.remove('border-accent', 'bg-panel', 'text-accent');
    });
  }

  rows.forEach(function (row) {
    row.addEventListener('click', function () {
      var repo = repoFor(row);
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
      if (!current.repo.included) return;
      var kind = btn.getAttribute('data-copy');
      current.shown = kind;
      var text = fill(tpl[kind], values());
      try {
        if (navigator.clipboard) navigator.clipboard.writeText(text);
      } catch (e) {}
      render();
      resetCopyButtons();
      btn.querySelector('[data-copy-label]').textContent = 'copied \\u2713';
      btn.classList.add('border-accent', 'bg-panel', 'text-accent');
      clearTimeout(copyTimer);
      copyTimer = setTimeout(resetCopyButtons, 1600);
    });
  });

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

  function restoreRefresh() {
    refreshBtn.disabled = false;
    refreshBtn.textContent = 'refresh now';
  }

  refreshBtn.addEventListener('click', function () {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'refreshing\\u2026';
    refreshNote.classList.add('hidden');
    fetch('/repos/' + current.repo.id + '/refresh', { method: 'POST' })
      .then(function (res) {
        if (res.status === 401) {
          location.href = '/auth/login';
          return;
        }
        if (res.status === 202) {
          refreshBtn.textContent = 'queued \\u2713';
          current.buster = Date.now();
          render();
          clearTimeout(refreshTimer);
          refreshTimer = setTimeout(restoreRefresh, 1600);
          return;
        }
        if (res.status === 429) {
          refreshNote.textContent = 'try again in a few minutes';
          refreshNote.classList.remove('hidden');
        }
        restoreRefresh();
      })
      .catch(restoreRefresh);
  });
})();`;

export function DashboardPage(props: DashboardPageProps) {
  const { login, repos, lastSyncAt } = props;
  return (
    <Layout title="GitCert — dashboard">
      <div class="mx-auto max-w-[1120px] px-7 pt-[52px] pb-24">
        <div class="font-mono text-[11px] tracking-[2px] text-muted uppercase">
          Dashboard · @{login}
        </div>
        <h1 class="mt-[10px] mb-[30px] text-[30px] font-medium tracking-[-0.4px]">
          Attest a repo, get a badge
        </h1>
        {repos[0] === undefined ? (
          <EmptyState />
        ) : (
          <DashboardCard repos={repos} selected={repos[0]} lastSyncAt={lastSyncAt} />
        )}
      </div>
    </Layout>
  );
}

/** No mock exists — minimal, tokens only (spec §Dashboard empty state). */
function EmptyState() {
  return (
    <div class="border border-hair-strong bg-card p-6">
      <div class={`${PANEL_HEADING_CLASS} mb-4`}>My repos</div>
      <div class="font-mono text-[13px] text-muted">
        No repos yet —{' '}
        <a href="https://github.com/apps/gitcert/installations/new">install GitCert on a repo</a> to
        get started.
      </div>
    </div>
  );
}

function DashboardCard(props: {
  repos: DashboardRepo[];
  selected: DashboardRepo;
  lastSyncAt: string | null;
}) {
  const { repos, selected, lastSyncAt } = props;
  const state = {
    repos: repos.map((r) => ({ id: r.id, owner: r.owner, name: r.name, included: r.included })),
    templates: { ...SNIPPET_TEMPLATES, badgePath: BADGE_PATH_TEMPLATE },
  };
  const stateJson = JSON.stringify(state).replace(/</g, '\\u003c');
  return (
    <div class="grid grid-cols-[400px_1fr] border border-hair-strong bg-card">
      <RepoPanel repos={repos} selected={selected} lastSyncAt={lastSyncAt} />
      <BuilderPanel selected={selected} />
      <script type="application/json" id="gc-state">
        {raw(stateJson)}
      </script>
      <script>{raw(DASHBOARD_SCRIPT)}</script>
    </div>
  );
}

function RepoPanel(props: {
  repos: DashboardRepo[];
  selected: DashboardRepo;
  lastSyncAt: string | null;
}) {
  const { repos, selected, lastSyncAt } = props;
  return (
    <div class="border-r border-hair p-6">
      <div class={`${PANEL_HEADING_CLASS} mb-4`}>My repos</div>
      <div data-repo-scroll class="-mx-1 max-h-[460px] overflow-x-hidden overflow-y-auto px-1">
        {repos.map((r) => (
          <RepoRow repo={r} selected={r === selected} />
        ))}
      </div>
      <div class="my-[18px] h-px bg-hair2" />
      <button
        type="button"
        id="gc-refresh"
        class="cursor-pointer rounded-[2px] border border-hair-strong bg-transparent px-[14px] py-2 font-mono text-[12.5px] text-ink"
      >
        refresh now
      </button>
      <div id="gc-refresh-note" class="mt-2 hidden font-mono text-[11px] text-muted" />
      <div class="mt-3 font-mono text-[11px] text-muted">
        last sync {lastSyncAt === null ? '—' : formatHhMmUtc(lastSyncAt)} UTC
      </div>
    </div>
  );
}

function RepoRow(props: { repo: DashboardRepo; selected: boolean }) {
  const { repo, selected } = props;
  return (
    <button
      type="button"
      data-repo-id={repo.id}
      class={`-mx-3 flex w-[calc(100%+24px)] cursor-pointer items-center gap-[10px] rounded-[3px] border-none p-3 text-left ${
        selected ? 'bg-panel' : 'bg-transparent'
      }`}
    >
      <span
        data-repo-name
        class={`inline-flex min-w-0 items-center gap-2 overflow-hidden font-mono text-[13.5px] ${
          repo.included ? 'text-ink' : 'text-faint'
        }${selected ? ' font-semibold' : ''}`}
      >
        <GithubRepoIcon />
        <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
          {repo.owner}/{repo.name}
        </span>
      </span>
      <span class="ml-auto flex-none font-mono text-[10px] text-faint">
        {repo.private ? 'private' : 'public'}
      </span>
    </button>
  );
}

function BuilderPanel(props: { selected: DashboardRepo }) {
  const { selected } = props;
  const enabled = selected.included;
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
    <div class="px-7 py-6">
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
      <div
        id="gc-preview-wrap"
        class="flex items-center justify-start rounded-[3px] border border-hair2 bg-preview p-[26px]"
      >
        <span class="inline-flex">
          <img id="gc-preview" src={previewSrc} alt="badge preview" />
        </span>
      </div>

      <div class="mt-6 flex flex-wrap gap-[9px]">
        <CopyButton kind="md" label="copy markdown" enabled={enabled} />
        <CopyButton kind="html" label="copy html" enabled={enabled} />
        <CopyButton kind="react" label="copy react" enabled={enabled} />
      </div>
      <pre
        id="gc-snippet"
        class="mt-[18px] overflow-x-auto rounded-[3px] border border-hair2 bg-panel2 px-4 py-[14px] font-mono text-[12px] leading-[1.5] break-all whitespace-pre-wrap text-body"
      >
        {snippets.md}
      </pre>
    </div>
  );
}

function CopyButton(props: { kind: 'md' | 'html' | 'react'; label: string; enabled: boolean }) {
  const { kind, label, enabled } = props;
  return (
    <button
      type="button"
      data-copy={kind}
      class={`${COPY_BTN_CLASS} ${enabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-45'}`}
    >
      <CopyIcon />
      <span data-copy-label>{label}</span>
    </button>
  );
}

/** GitHub repo glyph from the mock's repo rows (animation attrs not ported). */
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

/** Copy glyph from the mock's copy buttons. */
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

/** `HH:MM` (UTC) from an ISO timestamp — the mock's "last sync 14:03 UTC" line. */
function formatHhMmUtc(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
