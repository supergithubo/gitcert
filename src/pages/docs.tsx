/**
 * Public documentation page (third-export spec §Step 2), ported from
 * artifacts/design/docs.dc.html + docs-mobile.dc.html. Ten sections
 * (s1–s10): what GitCert is, install, the badges, using a badge, the verify
 * certificate, the JSON API, managing repos, disconnecting-or-switching,
 * trust model, self-hosting. A sticky section-nav sidebar on desktop
 * collapses to a <details> jump-list on mobile.
 *
 * Pure component: the route handler passes typed props; nothing here reads
 * D1, env, the clock, or GitHub. Zero client JS — the sidebar/jump-list are
 * plain #anchor links and a CSS <details>. When `account` is set the shared
 * Layout renders the account menu (same as every other signed-in surface).
 *
 * s3 "The badges" renders the eight REAL production badge templates via
 * docsDemo.ts (renderBadge) — no forked SVG. All copy obeys design decision
 * #5 (never "metadata-only" / "can never read your source"); the permissions
 * card and trust model are explicit that the App holds Contents:Read and the
 * collector is open source.
 */

import { raw } from 'hono/html';
import type { Child } from 'hono/jsx';
import { version } from '../../package.json';
import { sealSvg } from '../badges/seal';
import { DOCS_METRIC_ROWS } from './docsDemo';
import { GITHUB_REPO_URL, Layout, type Account } from './layout';

export interface DocsPageProps {
  /** null → signed-out nav; set → the shared account menu renders. */
  account: Account | null;
}

interface NavItem {
  id: string;
  num: string;
  label: string;
}

/** Sidebar / jump-list entries — labels shortened per the mock's nav. */
const NAV_ITEMS: readonly NavItem[] = [
  { id: 's1', num: '01', label: 'Overview' },
  { id: 's2', num: '02', label: 'Install' },
  { id: 's3', num: '03', label: 'The badges' },
  { id: 's4', num: '04', label: 'Using a badge' },
  { id: 's5', num: '05', label: 'The certificate' },
  { id: 's6', num: '06', label: 'The JSON API' },
  { id: 's7', num: '07', label: 'Managing repos' },
  { id: 's8', num: '08', label: 'Disconnect / switch' },
  { id: 's9', num: '09', label: 'Trust model' },
  { id: 's10', num: '10', label: 'Self-hosting' },
];

const EYEBROW_CLASS = 'font-mono text-[12px] tracking-[1px] text-accent mb-[10px]';
const H2_CLASS = 'text-[24px] font-medium tracking-[-0.3px] sm:text-[29px] sm:tracking-[-0.4px]';
const BODY_CLASS = 'text-[15px] leading-[1.65] text-body sm:text-[16px]';
const MONO_INLINE = 'font-mono text-[12.5px] text-muted';
const SECTION_RULE = <div class="my-9 h-px bg-hair2 sm:my-12" />;

/**
 * Scroll-driven active-nav highlight (ported from docs.dc.html lines 346–354,
 * 371–373). Like VERIFY_SCRIPT / THEME_INIT_SCRIPT this is a CONSTANT string
 * with ZERO interpolated user data — the only dynamic tokens are the static
 * section ids `s1`..`s10`, literals baked into the source. No owner/repo/handle
 * ever enters this script (there is nothing user-controlled on /docs at all).
 *
 * One IntersectionObserver (rootMargin '-25% 0px -65% 0px', threshold 0)
 * watches the ten <section id="sN"> and toggles `data-active` on the desktop
 * sidebar link whose href is `#sN`; the unlayered app.css rule
 * `[data-spy-link][data-active]` paints the accent border + ink text.
 *
 * Progressive enhancement: the sidebar and mobile jump-list are plain #anchor
 * links, so with JS disabled (or no IntersectionObserver) they still navigate;
 * only the scroll-following highlight is absent. The server pre-marks `s1`
 * active so the first paint matches the JS-disabled landing state.
 */
const SCROLLSPY_SCRIPT = `(function () {
  if (!('IntersectionObserver' in window)) return;
  var ids = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10'];
  var links = {};
  ids.forEach(function (id) {
    var a = document.querySelector('[data-spy-link][href="#' + id + '"]');
    if (a) links[id] = a;
  });
  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        ids.forEach(function (id) {
          if (!links[id]) return;
          if (id === en.target.id) links[id].setAttribute('data-active', '');
          else links[id].removeAttribute('data-active');
        });
      });
    },
    { rootMargin: '-25% 0px -65% 0px', threshold: 0 }
  );
  ids.forEach(function (id) {
    var el = document.getElementById(id);
    if (el) io.observe(el);
  });
})();`;

export function DocsPage(props: DocsPageProps) {
  return (
    <Layout title="GitCert — documentation" account={props.account}>
      <div class="mx-auto max-w-[1120px] px-4 sm:px-7">
        {props.account !== null ? (
          <a
            data-nav
            href="/dashboard"
            class="mt-6 inline-flex items-center gap-[6px] font-mono text-[12.5px] text-muted sm:mt-8"
          >
            ← Back to dashboard
          </a>
        ) : null}
        <div class="lg:grid lg:grid-cols-[216px_1fr] lg:items-start lg:gap-[60px]">
          <Sidebar />
          <main class="min-w-0 max-w-[748px] pt-7 pb-20 sm:pt-16 sm:pb-28">
            <DocsHeader />
            <JumpList />
            <SectionOverview />
            {SECTION_RULE}
            <SectionInstall />
            {SECTION_RULE}
            <SectionBadges />
            {SECTION_RULE}
            <SectionUsingABadge />
            {SECTION_RULE}
            <SectionCertificate />
            {SECTION_RULE}
            <SectionJsonApi />
            {SECTION_RULE}
            <SectionManaging />
            {SECTION_RULE}
            <SectionDisconnect />
            {SECTION_RULE}
            <SectionTrust />
            {SECTION_RULE}
            <SectionSelfHosting />
          </main>
        </div>
      </div>
      <script>{raw(SCROLLSPY_SCRIPT)}</script>
    </Layout>
  );
}

/** Desktop sticky section-nav. Hidden below lg (the JumpList takes over). */
function Sidebar() {
  return (
    <aside class="hidden lg:sticky lg:top-[82px] lg:block lg:py-16">
      <div class="mb-4 pl-[14px] font-mono text-[10px] tracking-[1.8px] text-faint uppercase">
        On this page
      </div>
      <nav class="flex flex-col">
        {NAV_ITEMS.map((it) => (
          <a
            data-nav
            data-spy-link
            data-active={it.id === 's1' ? '' : undefined}
            href={`#${it.id}`}
            class="-ml-[2px] flex items-baseline gap-[6px] border-l-2 border-transparent py-[7px] pl-[14px] font-mono text-[12.5px] leading-[1.3] text-muted"
          >
            <span class="w-5 flex-none text-[11px] text-faint">{it.num}</span>
            {it.label}
          </a>
        ))}
      </nav>
      <div class="mx-[14px] my-5 h-px bg-hair2" />
      <div class="pl-[14px] font-mono text-[11px] leading-[1.6] text-muted">
        Docs for GitCert v{version}
        <br />
        <a href={GITHUB_REPO_URL} target="_blank" rel="noopener" class="text-muted">
          changelog ↗
        </a>
      </div>
    </aside>
  );
}

/** Mobile "On this page" jump-list — a pure-CSS <details> disclosure. */
function JumpList() {
  return (
    <details data-jumplist class="mb-3 rounded-[4px] border border-hair-strong bg-card lg:hidden">
      <summary class="flex cursor-pointer list-none items-center justify-between px-4 py-3">
        <span class="font-mono text-[12px] tracking-[1px] text-muted uppercase">On this page</span>
        <span
          data-account-caret
          class="text-[10px] text-muted transition-transform duration-[180ms]"
        >
          ▾
        </span>
      </summary>
      <div class="border-t border-hair2">
        {NAV_ITEMS.map((it) => (
          <a
            data-nav
            href={`#${it.id}`}
            class="flex items-baseline gap-[8px] border-b border-hair2 px-4 py-[11px] font-mono text-[13px] text-muted last:border-b-0"
          >
            <span class="w-5 flex-none text-[11px] text-faint">{it.num}</span>
            {it.label}
          </a>
        ))}
      </div>
    </details>
  );
}

function DocsHeader() {
  return (
    <>
      <div class="mb-4 font-mono text-[11px] tracking-[2px] text-muted uppercase">
        Documentation
      </div>
      <h1 class="mb-[14px] text-[28px] leading-[1.12] font-medium tracking-[-0.5px] text-balance sm:mb-[18px] sm:text-[44px] sm:leading-[1.1] sm:tracking-[-0.8px]">
        Everything GitCert does, and why you can trust it.
      </h1>
      <p class="text-[15.5px] leading-[1.6] text-body text-pretty sm:text-[18px]">
        A single reference for installing the app, publishing badges, reading a certificate, and —
        most of all — understanding exactly what GitCert can and cannot see.
      </p>
      <div class="mt-9 h-px bg-hair sm:mt-11" />
    </>
  );
}

/** Shared <section> wrapper: scroll-margin clears the sticky header on jump. */
function Section(props: { id: string; children?: Child }) {
  return (
    <section id={props.id} class="scroll-mt-[92px] pt-1 sm:scroll-mt-[82px]">
      {props.children}
    </section>
  );
}

function SectionOverview() {
  return (
    <Section id="s1">
      <div class={EYEBROW_CLASS}>01 · Overview</div>
      <h2 class={`mb-4 ${H2_CLASS}`}>What GitCert is</h2>
      <p class={`mb-4 ${BODY_CLASS}`}>
        GitCert turns the activity inside your GitHub repositories — including private ones — into{' '}
        <strong class="font-semibold">verified, cryptographically signed statistics</strong> you can
        show anyone. It reads a repository&apos;s real numbers through a read-only GitHub App, signs
        them, and serves them back as badges.
      </p>
      <p class={`mb-6 ${BODY_CLASS}`}>
        Every badge links to a certificate that a skeptic can check independently. A recruiter or
        client trusts the numbers without ever seeing a line of your code.
      </p>
      <div class="grid grid-cols-1 gap-px overflow-hidden rounded-[4px] border border-hair bg-hair sm:grid-cols-3">
        <PropCard
          title="read-only"
          body="Reads your repo, never writes to it — no commits, issues, or settings."
        />
        <PropCard title="signed" body="Each response carries an Ed25519 signature from GitCert." />
        <PropCard
          title="verifiable"
          body="Anyone can confirm a number came from GitHub, unaltered."
        />
      </div>
    </Section>
  );
}

function PropCard(props: { title: string; body: string }) {
  return (
    <div class="bg-card px-[18px] pt-[18px] pb-5">
      <div class="mb-[6px] font-mono text-[12.5px] text-ink">{props.title}</div>
      <div class="text-[13.5px] leading-[1.5] text-soft">{props.body}</div>
    </div>
  );
}

function SectionInstall() {
  return (
    <Section id="s2">
      <div class={EYEBROW_CLASS}>02 · Getting started</div>
      <h2 class={`mb-5 ${H2_CLASS}`}>Install</h2>
      <div class="mb-6 flex flex-col gap-5">
        <InstallStep num="1.">
          <div class="mb-1 text-[15px] sm:text-[16px]">Connect the GitHub App</div>
          <div class="text-[14px] leading-[1.6] text-soft sm:text-[14.5px]">
            Authorize <strong class="font-semibold">GitCert</strong> from the GitHub Marketplace or
            the install button on the landing page. Installation takes about fifteen seconds and
            asks only for read access.
          </div>
        </InstallStep>
        <InstallStep num="2.">
          <div class="mb-1 text-[15px] sm:text-[16px]">Select repositories</div>
          <div class="text-[14px] leading-[1.6] text-soft sm:text-[14.5px]">
            Grant access to <em>all</em> repositories or a hand-picked set. GitCert only ever
            touches the repos you select — everything else stays invisible to it.
          </div>
        </InstallStep>
        <InstallStep num="3.">
          <div class="mb-1 text-[15px] sm:text-[16px]">Collection begins</div>
          <div class="text-[14px] leading-[1.6] text-soft sm:text-[14.5px]">
            GitCert reads each selected repo and starts serving badges. While a repo is first being
            read its badges show <span class={MONO_INLINE}>collecting…</span> — usually only for a
            moment.
          </div>
        </InstallStep>
      </div>
      <div class="overflow-hidden rounded-[4px] border border-hair-strong bg-card">
        <div class="flex items-center gap-[6px] border-b border-hair2 bg-panel2 px-4 py-[10px]">
          <span class="h-[10px] w-[10px] rounded-full bg-dot" />
          <span class="h-[10px] w-[10px] rounded-full bg-dot" />
          <span class="h-[10px] w-[10px] rounded-full bg-dot" />
          <span class="ml-2 font-mono text-[11px] text-muted">requested permissions</span>
        </div>
        <div class="px-[18px] py-4 font-mono text-[12.5px] leading-[1.7] text-body">
          <div class="grid grid-cols-[130px_auto] gap-y-[6px]">
            <span>Metadata</span>
            <span class="text-accent">Read-only</span>
            <span>Contents</span>
            <span class="text-accent">Read-only</span>
            <span>Issues</span>
            <span class="text-accent">Read-only</span>
            <span>Pull requests</span>
            <span class="text-accent">Read-only</span>
          </div>
          <div class="mt-[10px] text-faint">— no write scope requested —</div>
        </div>
      </div>
    </Section>
  );
}

function InstallStep(props: { num: string; children?: Child }) {
  return (
    <div class="grid grid-cols-[26px_1fr] items-start gap-4">
      <div class="pt-[2px] font-mono text-[13px] text-accent">{props.num}</div>
      <div>{props.children}</div>
    </div>
  );
}

function SectionBadges() {
  return (
    <Section id="s3">
      <div class={EYEBROW_CLASS}>03 · Reference</div>
      <h2 class={`mb-[14px] ${H2_CLASS}`}>The badges</h2>
      <p class={`mb-[22px] ${BODY_CLASS}`}>
        Eight metrics, each available in two styles and three themes. Every sample below is the live
        production SVG — the same markup served to a README.
      </p>
      {/*
       * s3 badge grid: a base-breakpoint stacked list (each row self-labels
       * its flat/pill sample) that becomes a CSS TABLE at sm — display:table /
       * table-row / table-cell with align-middle. The CSS-table (not flex) is
       * what column-aligns the three columns (metric | flat | pill) across all
       * eight rows regardless of each badge's intrinsic width; a flex row let
       * variable flat-badge widths shove the pill column around. The badge SVG
       * bytes are untouched — this is layout only (docs.dc.html 113–128).
       */}
      <div class="overflow-x-auto rounded-[4px] border border-hair-strong bg-card">
        <div class="sm:table sm:w-full sm:border-collapse">
          {/* Column header — hidden at base (rows self-label); a table-row at sm. */}
          <div class="hidden sm:table-row">
            <span class="border-b border-hair2 bg-panel2 py-[11px] pr-[22px] pl-[18px] font-mono text-[10.5px] tracking-[1px] whitespace-nowrap text-muted uppercase sm:table-cell sm:align-middle">
              metric
            </span>
            <span class="border-b border-hair2 bg-panel2 px-[22px] py-[11px] font-mono text-[10.5px] tracking-[1px] whitespace-nowrap text-muted uppercase sm:table-cell sm:align-middle">
              flat
            </span>
            <span class="w-full border-b border-hair2 bg-panel2 px-[18px] py-[11px] font-mono text-[10.5px] tracking-[1px] whitespace-nowrap text-muted uppercase sm:table-cell sm:align-middle">
              pill
            </span>
          </div>
          {DOCS_METRIC_ROWS.map((row) => (
            <div class="flex flex-col gap-[10px] border-b border-hair2 px-4 py-[13px] last:border-b-0 sm:table-row">
              <span class="font-mono text-[12px] text-soft sm:table-cell sm:border-b sm:border-hair2 sm:py-[13px] sm:pr-[22px] sm:pl-[18px] sm:align-middle sm:text-[12.5px] sm:whitespace-nowrap">
                {row.name}
              </span>
              <span class="flex items-center gap-3 sm:table-cell sm:border-b sm:border-hair2 sm:px-[22px] sm:py-[13px] sm:align-middle sm:whitespace-nowrap">
                <span class="w-[26px] flex-none font-mono text-[10px] text-muted sm:hidden">
                  flat
                </span>
                <span class="inline-flex">{raw(row.flat)}</span>
              </span>
              <span class="flex items-center gap-3 sm:table-cell sm:w-full sm:border-b sm:border-hair2 sm:px-[18px] sm:py-[13px] sm:align-middle sm:whitespace-nowrap">
                <span class="w-[26px] flex-none font-mono text-[10px] text-muted sm:hidden">
                  pill
                </span>
                <span class="inline-flex">{raw(row.pill)}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
      <div class="mt-5 grid grid-cols-1 gap-[14px] sm:grid-cols-2">
        <SettingCard title="style">
          <span class="text-body">flat</span> — the two-segment README default.{' '}
          <span class="text-body">pill</span> — a bordered chip that sits inline in body text. Set
          with <span class="font-mono text-[12px] text-muted">?style=flat|pill</span>.
        </SettingCard>
        <SettingCard title="theme">
          <span class="text-body">auto</span> follows the reader&apos;s system setting;{' '}
          <span class="text-body">light</span> and <span class="text-body">dark</span> force one.
          Set with <span class="font-mono text-[12px] text-muted">?theme=auto|light|dark</span>.
        </SettingCard>
      </div>
    </Section>
  );
}

function SettingCard(props: { title: string; children?: Child }) {
  return (
    <div class="rounded-[4px] border border-hair px-[18px] py-4">
      <div class="mb-[6px] font-mono text-[12.5px] text-ink">{props.title}</div>
      <div class="text-[13.5px] leading-[1.55] text-soft">{props.children}</div>
    </div>
  );
}

function SectionUsingABadge() {
  return (
    <Section id="s4">
      <div class={EYEBROW_CLASS}>04 · Reference</div>
      <h2 class={`mb-[14px] ${H2_CLASS}`}>Using a badge</h2>
      <p class={`mb-[22px] ${BODY_CLASS}`}>
        Copy a badge from the dashboard in whichever format your surface takes, then paste it into a
        README, a portfolio, or a résumé. Each snippet already wraps the badge in a link to its
        signed certificate.
      </p>
      <CodeBlock label="Markdown">
        [![commits](https://gitcert.harborstack.app/b/johndoe/client-platform/commits.svg)](https://gitcert.harborstack.app/verify/johndoe/client-platform)
      </CodeBlock>
      <CodeBlock label="HTML">
        {'<a href="https://gitcert.harborstack.app/verify/johndoe/client-platform">\n' +
          '  <img src="https://gitcert.harborstack.app/b/johndoe/client-platform/commits.svg"\n' +
          '       alt="commits — attested by GitCert" />\n' +
          '</a>'}
      </CodeBlock>
      <CodeBlock label="React">
        {'<a href="https://gitcert.harborstack.app/verify/johndoe/client-platform">\n' +
          '  <img\n' +
          '    src="https://gitcert.harborstack.app/b/johndoe/client-platform/commits.svg"\n' +
          '    alt="commits — attested by GitCert"\n' +
          '  />\n' +
          '</a>'}
      </CodeBlock>
      <div class="flex items-start gap-[10px] text-[14px] leading-[1.6] text-soft">
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--accent)"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="mt-[2px] flex-none"
        >
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        <span>
          Because the image is wrapped in the certificate link, a reviewer who clicks any badge
          lands on the proof — not on the file the badge was copied into.
        </span>
      </div>
    </Section>
  );
}

function CodeBlock(props: { label: string; children?: Child }) {
  return (
    <>
      <div class="mb-2 font-mono text-[11px] tracking-[1.5px] text-muted uppercase">
        {props.label}
      </div>
      <pre class="mb-5 overflow-x-auto rounded-[3px] border border-hair2 bg-panel2 px-4 py-[14px] font-mono text-[12.5px] leading-[1.55] break-words whitespace-pre-wrap text-body">
        {props.children}
      </pre>
    </>
  );
}

function SectionCertificate() {
  return (
    <Section id="s5">
      <div class={EYEBROW_CLASS}>05 · Reference</div>
      <h2 class={`mb-[14px] ${H2_CLASS}`}>The verify certificate</h2>
      <p class={`mb-[22px] ${BODY_CLASS}`}>
        Every badge points at{' '}
        <span class="font-mono text-[13px] text-muted">/verify/&lt;owner&gt;/&lt;repo&gt;</span>.
        The certificate restates each attested number, records when it was read, and carries the
        signature that proves it.
      </p>
      <div class="mb-[22px] rounded-[4px] border border-hair-strong bg-card px-6 pt-[22px] pb-6">
        <div class="mb-4 flex items-center justify-between">
          <div class="flex items-center gap-[9px]">
            {raw(sealSvg({ size: 20, kind: 'check', color: 'var(--accent)' }))}
            <span class="font-mono text-[14px] font-semibold">Attestation</span>
          </div>
          <span class="font-mono text-[12px] text-muted"># GC-7F2A41</span>
        </div>
        <div class="grid grid-cols-[100px_1fr] gap-x-4 gap-y-[9px] font-mono text-[12.5px] text-body sm:grid-cols-[120px_1fr]">
          <span class="text-muted">commits</span>
          <span>1,247</span>
          <span class="text-muted">attested</span>
          <span>Jul 22 2026, 14:03 UTC</span>
          <span class="text-muted">signature</span>
          <span class="flex flex-wrap items-center gap-[10px]">
            ed25519 a41f…9c2e{' '}
            <span class="inline-flex items-center gap-[5px] rounded-[3px] border border-accent px-2 py-[2px] text-[11px] text-accent">
              verify ✓
            </span>
          </span>
        </div>
      </div>
      <p class="mb-2 text-[14.5px] leading-[1.65] text-soft">
        Pressing <span class={MONO_INLINE}>[verify]</span> re-checks the Ed25519 signature against
        GitCert&apos;s public key, right in the reader&apos;s browser. A valid result means the
        numbers are exactly what GitHub returned and have not been edited since.
      </p>
      <a
        data-nav
        href="/verify/supergithubo/wnston.dev"
        target="_blank"
        rel="noopener"
        class="mt-[6px] inline-flex items-center gap-[6px] font-mono text-[13px] text-accent"
      >
        See a live certificate →
      </a>
    </Section>
  );
}

/**
 * The s6 example envelope. NOT the design mock's block, which was a
 * placeholder and factually wrong (it showed `owner`/`repo`/`metrics`/
 * `attested_at`/`cert_id` and an `ed25519:`-prefixed signature). This mirrors
 * what the code actually serves:
 *
 * - key order is the REAL serialized order — `src/lib/payload.ts` sorts keys
 *   alphabetically at every level before signing;
 * - `collected_at` carries milliseconds because it comes from `toISOString()`;
 * - `language_pct` is 81.3, not 81.0 — `JSON.stringify(81.0)` emits `81`;
 * - the signature is BARE standard base64 (`src/lib/sign.ts` returns `btoa` of
 *   the raw signature bytes) — there is no algorithm prefix to strip;
 * - envelope key order is fixed by the string concatenation in
 *   `src/routes/api.ts`: payload, signature, public_key_url.
 *
 * The signature string is illustrative and elided with `…` — it is not a real
 * signature over this payload and cannot be made to verify.
 */
const API_RESPONSE_EXAMPLE = `{
  "payload": {
    "cert_serial": "GC-7F2A41",
    "collected_at": "2026-07-22T14:03:00.417Z",
    "issuer": "gitcert.harborstack.app",
    "method": "github-app/read-only",
    "private": true,
    "repo": "johndoe/client-platform",
    "stats": {
      "commits": 1247,
      "created_at": "2023-02-14T08:30:12Z",
      "first_commit_at": "2023-02-14T09:02:57Z",
      "language_pct": 81.3,
      "languages": [{ "name": "TypeScript", "pct": 81.3 }],
      "last_commit_at": "2026-07-21T09:12:44Z",
      "open_issues": 3,
      "open_prs": 2,
      "primary_language": "TypeScript",
      "size_kb": 48213
    },
    "v": 1
  },
  "signature": "kR8v2Qc7…N0pQ==",
  "public_key_url": "https://gitcert.harborstack.app/pubkey"
}`;

/**
 * The s6 terminal recipe. Every line is verifiable against shipped code:
 *
 * - it slices the payload bytes out of the RAW envelope and never re-serializes
 *   them, mirroring `verify.tsx` — a JSON round-trip reorders/reformats and
 *   fails a genuine certificate (attestation invariant);
 * - `rindex` mirrors `verify.tsx`'s `lastIndexOf(',"signature"')`;
 * - `/pubkey` returns JSON (`{ algorithm, public_key, jwk }`), so the key is
 *   read out of `['public_key']`, not from a raw base64 file;
 * - the signature is decoded directly — no `split(':')`, there is no prefix;
 * - the serial field is `cert_serial`.
 */
const API_VERIFY_RECIPE = `# pip install pynacl
curl -s https://gitcert.harborstack.app/api/johndoe/client-platform.json -o cert.json
curl -s https://gitcert.harborstack.app/pubkey -o gitcert.pub.json

python3 - <<'PY'
import json, base64
from nacl.signing import VerifyKey

raw = open('cert.json', 'rb').read()
env = json.loads(raw)

# the payload bytes exactly as served — re-serializing them
# would change the bytes and fail a perfectly valid certificate
start = raw.index(b'"payload":') + len(b'"payload":')
end   = raw.rindex(b',"signature"')
payload = raw[start:end]

key = base64.b64decode(json.load(open('gitcert.pub.json'))['public_key'])
sig = base64.b64decode(env['signature'])
VerifyKey(key).verify(payload, sig)
print('signature ok —', json.loads(payload)['cert_serial'])
PY`;

/**
 * s6 — the same signed record the badges render, served raw. The endpoint and
 * `/pubkey` already ship; this section only makes them visible.
 */
function SectionJsonApi() {
  return (
    <Section id="s6">
      <div class={EYEBROW_CLASS}>06 · Reference</div>
      <h2 class={`mb-[14px] ${H2_CLASS}`}>The JSON API</h2>
      <p class={`mb-6 ${BODY_CLASS}`}>
        A badge is one rendering of a signed record. The same record is served raw, as JSON — one
        endpoint per repository — for a CI check, a dashboard, or a portfolio site that would rather
        set the number in its own type. No key, no token.
      </p>

      <CodeBlock label="Endpoint">
        curl -s https://gitcert.harborstack.app/api/johndoe/client-platform.json
      </CodeBlock>
      {/* No existence oracle: every hidden cause answers identically. */}
      <p class="mb-7 text-[14px] leading-[1.65] text-soft sm:text-[14.5px]">
        The endpoint publishes exactly what the badges already publish, and nothing else.
        Repositories you have not enabled are not served: excluded, uninstalled, and never-created
        are answered identically, so a request that fails tells the caller nothing about what does
        or does not exist on GitHub.
      </p>

      <CodeBlock label="Response">{API_RESPONSE_EXAMPLE}</CodeBlock>
      <div class="mb-[14px] flex flex-col gap-3 rounded-[4px] border border-hair px-4 py-[15px] sm:grid sm:grid-cols-[auto_1fr] sm:gap-x-5 sm:gap-y-3 sm:px-5 sm:py-[18px]">
        <ApiField name="payload">
          The signed record: the repository and whether it is private, the stats GitCert read and
          the UTC moment it read them, the issuer and method behind the reading, the payload
          version, and the certificate serial printed on the verify page.
        </ApiField>
        <ApiField name="signature">
          Ed25519 over the payload bytes exactly as served, standard base64. There is no algorithm
          prefix — decode the string directly.
        </ApiField>
        <ApiField name="public_key_url">
          Where to fetch the verifying key. <span class={MONO_INLINE}>/pubkey</span> answers with{' '}
          <span class={MONO_INLINE}>algorithm</span>, <span class={MONO_INLINE}>public_key</span>{' '}
          and <span class={MONO_INLINE}>jwk</span>; <span class={MONO_INLINE}>public_key</span> is
          the raw 32-byte Ed25519 key in standard base64.
        </ApiField>
      </div>
      <p class="mb-7 text-[14px] leading-[1.65] text-soft sm:text-[14.5px]">
        The block above is pretty-printed for reading. The endpoint itself serves compact JSON with{' '}
        <span class={MONO_INLINE}>payload</span> first, and the bytes between{' '}
        <span class={MONO_INLINE}>&quot;payload&quot;:</span> and{' '}
        <span class={MONO_INLINE}>,&quot;signature&quot;</span> are precisely what was signed.
      </p>

      <CodeBlock label="Verify it yourself">{API_VERIFY_RECIPE}</CodeBlock>
      <div class="flex items-start gap-[10px] text-[13.5px] leading-[1.6] text-soft sm:text-[14px]">
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--accent)"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="mt-[2px] flex-none"
        >
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        <span>
          Verify the bytes, not your reading of them. <span class={MONO_INLINE}>jq .payload</span>,
          a JSON round-trip in any language, or simply re-indenting the file all produce different
          bytes — and a genuine certificate will fail the check. Hand the served slice to the
          verifier untouched.
        </span>
      </div>
    </Section>
  );
}

/**
 * One row of the s6 envelope-field card. `sm:contents` flattens the pair into
 * the parent grid at desktop (name column + description column); at base the
 * wrapper stays a block so the name sits above its description, matching
 * docs-mobile. Kept module-private — neither SettingCard (title + prose, its
 * own bordered box) nor ManageRow (fixed 150px column, no box) fits this shape.
 */
function ApiField(props: { name: string; children?: Child }) {
  return (
    <div class="sm:contents">
      <div class="mb-[3px] font-mono text-[12px] text-ink sm:mb-0 sm:text-[12.5px] sm:whitespace-nowrap">
        {props.name}
      </div>
      <div class="text-[13.5px] leading-[1.6] text-soft sm:text-[14px]">{props.children}</div>
    </div>
  );
}

function SectionManaging() {
  return (
    <Section id="s7">
      <div class={EYEBROW_CLASS}>07 · Managing</div>
      <h2 class={`mb-5 ${H2_CLASS}`}>Managing repos</h2>
      <div class="flex flex-col gap-[18px]">
        <ManageRow title="enable / hide">
          Each repo has an <span class="text-body">enable</span> toggle on the dashboard. Enabled,
          its badges resolve. Switched off, GitCert stops publishing it and its badges return{' '}
          <span class={MONO_INLINE}>not found</span> — a fast way to hide a repo without touching
          GitHub.
        </ManageRow>
        <ManageRow title="refresh">
          GitCert re-reads on a schedule. Press <span class={MONO_INLINE}>refresh now</span> to pull
          the latest numbers immediately after a push.
        </ManageRow>
        <ManageRow title="reselect repos">
          To add or drop repositories from GitCert&apos;s reach entirely, use{' '}
          <span class="text-body">edit repos</span>, which opens the App&apos;s repository access
          screen on GitHub. Removing a repo here is stronger than hiding it — GitCert can no longer
          read it at all.
        </ManageRow>
      </div>
    </Section>
  );
}

function ManageRow(props: { title: string; children?: Child }) {
  return (
    <div class="grid grid-cols-1 gap-2 sm:grid-cols-[150px_1fr] sm:items-start sm:gap-4">
      <div class="pt-[1px] font-mono text-[13px] text-ink">{props.title}</div>
      <div class="text-[14.5px] leading-[1.6] text-soft">{props.children}</div>
    </div>
  );
}

/**
 * s8 — the prominent switch-vs-revoke distinction (spec Constraints): two
 * cards side by side. Switch account = Sign out (session only); Revoke access
 * = uninstall on GitHub (removes read access). They must never be confused.
 */
function SectionDisconnect() {
  return (
    <Section id="s8">
      <div class={EYEBROW_CLASS}>08 · Important</div>
      <h2 class={`mb-2 ${H2_CLASS}`}>Disconnecting or switching</h2>
      <p class={`mb-6 ${BODY_CLASS}`}>
        Two different actions that are easy to confuse. One ends a browser session; the other
        removes GitCert&apos;s access to your account. Pick deliberately.
      </p>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="rounded-[5px] border border-hair-strong bg-card px-[22px] pt-[22px] pb-6">
          <div class="mb-3 flex items-center gap-[9px]">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--soft)"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span class="font-mono text-[13px] font-semibold text-ink">Switch account</span>
          </div>
          <div class="mb-[10px] font-mono text-[11px] tracking-[1px] text-muted uppercase">
            session only
          </div>
          <p class="mb-3 text-[14px] leading-[1.6] text-soft">
            Open the <span class="font-mono text-[12.5px] text-body">@handle</span> menu in the top
            bar and choose <strong class="font-semibold text-body">Sign out</strong>, then sign in
            again as a different GitHub account.
          </p>
          <p class="text-[14px] leading-[1.6] text-soft">
            This only ends your dashboard session. GitCert stays installed and every badge keeps
            resolving — nothing about repo access changes.
          </p>
        </div>
        <div class="rounded-[5px] border border-hair-strong bg-card px-[22px] pt-[22px] pb-6">
          <div class="mb-3 flex items-center gap-[9px]">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--soft)"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
            <span class="font-mono text-[13px] font-semibold text-ink">Revoke access</span>
          </div>
          <div class="mb-[10px] font-mono text-[11px] tracking-[1px] text-muted uppercase">
            uninstall the app
          </div>
          <p class="mb-3 text-[14px] leading-[1.6] text-soft">
            On GitHub, go to{' '}
            <span class="font-mono text-[12px] text-body">
              Settings → Applications → Installed GitHub Apps → GitCert → Uninstall
            </span>
            .
          </p>
          <p class="mb-[14px] text-[14px] leading-[1.6] text-soft">
            GitCert immediately loses all read access. Collection stops and every badge flips to{' '}
            <span class={MONO_INLINE}>not found</span>.
          </p>
          <a
            href="https://github.com/settings/installations"
            target="_blank"
            rel="noopener"
            class="font-mono text-[12.5px] text-muted"
          >
            Disconnect GitCert from GitHub ↗
          </a>
        </div>
      </div>
    </Section>
  );
}

function SectionTrust() {
  return (
    <Section id="s9">
      <div class={EYEBROW_CLASS}>09 · Trust</div>
      <h2 class={`mb-5 ${H2_CLASS}`}>Trust model</h2>
      <div class="flex flex-col gap-4">
        <TrustPoint title="Read-only, by construction">
          The App requests no write scope of any kind. It cannot open issues, push commits, or
          change settings — the permission simply isn&apos;t granted.
        </TrustPoint>
        <TrustPoint title="No long-lived credentials">
          GitCert authenticates with short-lived installation tokens minted per request. It never
          stores a personal access token or your password.
        </TrustPoint>
        <TrustPoint title="No existence oracle">
          A repo you excluded, one you removed, and one that never existed all return an identical{' '}
          <span class={MONO_INLINE}>not found</span>. GitCert can&apos;t be used to probe whether a
          private repository exists.
        </TrustPoint>
        <TrustPoint title="Open-source collector">
          The service that reads and signs your numbers is{' '}
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener"
            class="text-soft underline underline-offset-2 hover:text-accent"
          >
            public
          </a>
          . Audit exactly which fields are touched and how each response is signed.
        </TrustPoint>
      </div>
    </Section>
  );
}

function TrustPoint(props: { title: string; children?: Child }) {
  return (
    <div class="grid grid-cols-[24px_1fr] items-start gap-[14px]">
      <div class="pt-[1px] font-mono text-[14px] text-accent">·</div>
      <div>
        <div class="mb-[3px] text-[15.5px]">{props.title}</div>
        <div class="text-[14px] leading-[1.6] text-soft">{props.children}</div>
      </div>
    </div>
  );
}

function SectionSelfHosting() {
  return (
    <Section id="s10">
      <div class={EYEBROW_CLASS}>10 · Advanced</div>
      <h2 class={`mb-[14px] ${H2_CLASS}`}>Self-hosting</h2>
      <p class={`mb-5 ${BODY_CLASS}`}>
        Prefer to run the whole thing yourself? The collector, signer, and badge renderer are open
        source. Point your own GitHub App at your own deployment and issue certificates under a key
        you control.
      </p>
      <a
        data-nav
        href={GITHUB_REPO_URL}
        target="_blank"
        rel="noopener"
        class="inline-flex items-center gap-2 rounded-[3px] bg-ink px-[18px] py-[11px] font-mono text-[13px] text-paper"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" class="block">
          <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
        </svg>
        supergithubo/gitcert
      </a>
    </Section>
  );
}
