/**
 * Landing page (M4 spec §Step 1), ported from
 * artifacts/design/landing-{unauth,auth}.dc.html — the two mocks are
 * identical except the CTA block, switched here on `props.auth`. Pure
 * component: the route handler passes typed props; nothing here reads D1,
 * env, or the clock. Zero client JS.
 *
 * Not ported (spec do-not-port list): design-tool runtime, theme toggle
 * (pages follow prefers-color-scheme — M2 precedent), hover/draw keyframe
 * animations, vestigial closed-issues/merged-prs data, the dead revoked
 * seal branch. Copy is the patched mock copy verbatim (decision #5: never
 * "metadata-only", never "can never read your source"); the collector and
 * permissions mentions link to the public repo.
 */

import { raw } from 'hono/html';
import type { Child } from 'hono/jsx';
import { sealSvg } from '../badges/seal';
import { GITHUB_MARK_PATH, GITHUB_REPO_URL, Layout } from './layout';
import { HERO_PILLS, INLINE_PILLS, README_FLATS } from './landingDemo';

/** Frozen M4 interface — both agents build to this. */
export interface LandingPageProps {
  /** null → signed-out variant; set → signed-in CTA variant. */
  auth: { attestedCount: number } | null;
}

const EYEBROW_CLASS = 'font-mono text-[11px] tracking-[2px] text-muted uppercase';
const MICROCOPY_CLASS = 'mt-[14px] font-mono text-[12px] text-muted';
const CTA_CLASS =
  'inline-flex items-center gap-[9px] rounded-[3px] bg-ink px-6 py-[13px] font-mono text-[14px] tracking-[0.3px] text-paper';

export function LandingPage(props: LandingPageProps) {
  return (
    <Layout title="GitCert — verified badges for private GitHub repositories">
      <Hero auth={props.auth} />
      <StepsStrip />
      <div class="mx-auto max-w-[1000px] px-7 py-14">
        <ReadmeCard />
        <InlineSiteCard />
      </div>
      <TrustStrip />
    </Layout>
  );
}

function Hero(props: { auth: LandingPageProps['auth'] }) {
  return (
    <div class="mx-auto max-w-[900px] px-7 pt-[78px] pb-12 text-center">
      <div class={`mb-[22px] ${EYEBROW_CLASS}`}>Verified repository stats</div>
      <h1 class="mb-5 text-[52px] leading-[1.08] font-medium tracking-[-1px] text-balance">
        Your private work,
        <br />
        independently attested.
      </h1>
      <p class="mx-auto mb-8 max-w-[560px] text-[18px] leading-[1.55] text-body text-pretty">
        Badges for repos nobody else can see — and public ones too. GitCert reads your real stats
        from GitHub, signs them, and serves badges that recruiters and clients can verify.
      </p>
      <div class="mb-9 flex flex-wrap justify-center gap-[10px]">
        {HERO_PILLS.map((svg) => (
          <span class="inline-flex">{raw(svg)}</span>
        ))}
      </div>
      {props.auth === null ? <ConnectCta /> : <DashboardCta count={props.auth.attestedCount} />}
    </div>
  );
}

/** Signed-out CTA: GitHub mark + "Connect GitHub" → /auth/login. */
function ConnectCta() {
  return (
    <>
      <a data-nav href="/auth/login" class={CTA_CLASS}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" class="block">
          <path d={GITHUB_MARK_PATH} />
        </svg>
        Connect GitHub
      </a>
      <div class={MICROCOPY_CLASS}>read-only · installs in ~15s</div>
    </>
  );
}

/** Signed-in CTA: "Go to Dashboard →" + pluralized attested-repo microcopy. */
function DashboardCta(props: { count: number }) {
  const noun = props.count === 1 ? 'repo' : 'repos';
  return (
    <>
      <a data-nav href="/dashboard" class={CTA_CLASS}>
        Go to Dashboard
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="block"
        >
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </a>
      <div class={MICROCOPY_CLASS}>
        signed in · {props.count} {noun} attested
      </div>
    </>
  );
}

const STEPS: readonly { num: string; title: string; body: string }[] = [
  {
    num: '01',
    title: 'Install the app',
    body: 'Authorize the GitHub App with read-only access. It counts commits, issues, and PRs — it never writes a byte, and only the repos you pick are touched.',
  },
  {
    num: '02',
    title: 'Pick repos',
    body: 'Choose exactly which private repositories to attest. Toggle any repo off at any time and its badges stop resolving immediately — you stay in control.',
  },
  {
    num: '03',
    title: 'Copy your badge',
    body: 'Grab your badge as Markdown, HTML, or a React component and paste it into a README, portfolio, or resume. Every badge links back to a signed certificate.',
  },
];

function StepsStrip() {
  return (
    <div class="border-t border-b border-hair bg-panel">
      <div class="mx-auto grid max-w-[1000px] grid-cols-3 gap-9 px-7 py-11">
        {STEPS.map((step) => (
          <div>
            <div class="font-mono text-[12px] text-accent">{step.num}</div>
            <div class="mt-2 mb-[6px] text-[19px]">{step.title}</div>
            <div class="text-[14.5px] leading-[1.55] text-body">{step.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReadmeCard() {
  return (
    <>
      <div class={`mb-[18px] ${EYEBROW_CLASS}`}>In your README — public or private</div>
      <BrowserCard filename="README.md">
        <h2 class="mb-1 font-mono text-[24px] font-semibold tracking-[-0.4px]">client-platform</h2>
        <p class="mb-4 text-[14.5px] leading-[1.5] text-body">
          Internal platform services. Private repository.
        </p>
        <div class="mb-[22px] flex flex-wrap gap-[7px]">
          {README_FLATS.map((svg) => (
            <span class="inline-flex">{raw(svg)}</span>
          ))}
        </div>
        <div class="mb-4 h-px bg-hair2" />
        <p class="text-[14px] leading-[1.6] text-soft">
          Every badge above links to a signed certificate. A reviewer clicks through and confirms
          the numbers came straight from GitHub — not from this file.
        </p>
      </BrowserCard>
    </>
  );
}

function InlineSiteCard() {
  return (
    <>
      <div class={`mt-11 mb-4 ${EYEBROW_CLASS}`}>…and inline on your site</div>
      <BrowserCard filename="<yoursite>.io">
        <h2 class="mb-1 font-mono text-[24px] font-semibold tracking-[-0.4px]">John Doe</h2>
        <p class="mb-5 text-[14.5px] leading-[1.5] text-body">
          Platform engineer. Building internal services in the open.
        </p>
        <div class="grid grid-cols-[150px_1fr] items-center gap-x-6 gap-y-[14px] text-[15px]">
          <div class="text-soft">repository</div>
          <div class="flex flex-wrap items-center gap-[10px]">
            GitHub <span class="text-muted">(Private)</span>
            {INLINE_PILLS.map((svg, i) => (
              <span class={i === 0 ? 'ml-auto inline-flex' : 'inline-flex'}>{raw(svg)}</span>
            ))}
          </div>
          <div class="text-soft">documentation</div>
          <div class="flex items-center gap-[10px]">
            API Docs
            <span class="ml-auto font-mono text-[13px] text-muted">{'<yoursite>.io/api'} ↗</span>
          </div>
        </div>
      </BrowserCard>
    </>
  );
}

/** Window-chrome card shared by the README and inline-site demos. */
function BrowserCard(props: { filename: string; children?: Child }) {
  return (
    <div class="overflow-hidden rounded-[4px] border border-hair-strong bg-card">
      <div class="flex items-center gap-[6px] border-b border-hair2 bg-panel2 px-4 py-[11px]">
        <span class="h-[11px] w-[11px] rounded-full bg-dot" />
        <span class="h-[11px] w-[11px] rounded-full bg-dot" />
        <span class="h-[11px] w-[11px] rounded-full bg-dot" />
        <span class="ml-2 font-mono text-[11px] text-muted">{props.filename}</span>
      </div>
      <div class="px-8 py-7">{props.children}</div>
    </div>
  );
}

const LOCK_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="display:block"><rect height="11" rx="2" ry="2" width="18" x="3" y="11"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;

const OCTOCAT_OUTLINE_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="display:block"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>`;

function TrustStrip() {
  return (
    <div class="border-t border-hair bg-panel">
      <div class="mx-auto grid max-w-[1000px] grid-cols-3 gap-8 px-7 py-10">
        <TrustItem icon={LOCK_ICON} heading="read-only permissions">
          GitCert holds <a href={GITHUB_REPO_URL}>read-only permissions</a> and keeps only
          aggregates — commit counts, timestamps, issue and PR totals. It never stores your code or
          writes a byte to your repositories.
        </TrustItem>
        <TrustItem icon={OCTOCAT_OUTLINE_ICON} heading="open source collector">
          The collector service is <a href={GITHUB_REPO_URL}>fully open source</a> — audit exactly
          which fields are read and how they're signed. Nothing runs behind closed doors.
        </TrustItem>
        <TrustItem
          icon={sealSvg({ size: 20, kind: 'check', color: 'var(--accent)' })}
          heading="signed responses"
        >
          Every badge and certificate carries an ed25519 signature. Anyone can independently verify
          a response came from GitCert and was never tampered with.
        </TrustItem>
      </div>
    </div>
  );
}

function TrustItem(props: { icon: string; heading: string; children?: Child }) {
  return (
    <div class="flex items-start gap-3">
      <span class="mt-[2px] flex-none">{raw(props.icon)}</span>
      <div>
        <div class="mb-1 font-mono text-[13px]">{props.heading}</div>
        <div class="text-[13.5px] leading-[1.5] text-soft">{props.children}</div>
      </div>
    </div>
  );
}
