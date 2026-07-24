/**
 * Verify certificate pages (M2 spec §Routes /verify/:owner/:repo), ported
 * from artifacts/design/verify{,-collecting,-notfound}.dc.html. Pure
 * components: route handlers pass typed props; nothing here reads D1, the
 * clock, or env. The inline verify-button script is the ONLY client JS in
 * M2 (spec-level sign-off) — it is a constant string with no interpolated
 * user data (owner/repo are read from location.pathname).
 */

import { raw } from 'hono/html';
import type { Child } from 'hono/jsx';
import { formatCount, formatFullDate, formatSizeKb, formatTimestampUtc } from '../badges/format';
import { renderBadge } from '../badges/render';
import { sealSvg } from '../badges/seal';
import type { PublicStats } from '../lib/types';
import { GITHUB_REPO_URL, Layout } from './layout';

export interface VerifyProps {
  owner: string;
  repo: string;
  isPrivate: boolean;
  certSerial: string;
  collectedAt: string;
  /** Base64 Ed25519 signature — rendered as first-4…last-4. */
  signature: string;
  stats: PublicStats;
  /**
   * When true (a signed-in viewer, set by the session-aware route), render a
   * generic `← Back to dashboard` link in the CertFrame. Omitted by default so
   * the cookie-less cached path stays byte-identical. The link is always the
   * generic `/dashboard` — never repo/owner/cause-derived (no existence oracle).
   */
  backLink?: boolean;
}

/**
 * Browser-side Ed25519 verification (WebCrypto). Extracts the payload bytes
 * by slicing the envelope text — never JSON.parse→re-serialize on the
 * signed bytes (attestation rules).
 */
const VERIFY_SCRIPT = `(function () {
  var btn = document.getElementById('gc-verify-btn');
  if (!btn) return;
  function show(el, display) {
    el.classList.remove('hidden');
    el.classList.add(display);
  }
  function hide(el, display) {
    el.classList.add('hidden');
    el.classList.remove(display);
  }
  btn.addEventListener('click', function () {
    var ok = document.getElementById('gc-sig-valid');
    var msg = document.getElementById('gc-sig-msg');
    hide(ok, 'inline-flex');
    hide(msg, 'inline');
    var parts = location.pathname.split('/');
    var api = '/api/' + parts[2] + '/' + parts[3] + '.json';
    Promise.all([
      fetch(api).then(function (r) { if (!r.ok) throw new Error('api'); return r.text(); }),
      fetch('/pubkey').then(function (r) { if (!r.ok) throw new Error('pubkey'); return r.json(); }),
    ])
      .then(function (results) {
        var envelope = results[0];
        var payload = envelope.slice('{"payload":'.length, envelope.lastIndexOf(',"signature"'));
        var signature = JSON.parse(envelope).signature;
        var toBytes = function (b64) {
          return Uint8Array.from(atob(b64), function (c) { return c.charCodeAt(0); });
        };
        var keyBytes = toBytes(results[1].public_key);
        var sigBytes = toBytes(signature);
        return crypto.subtle
          .importKey('raw', keyBytes, { name: 'Ed25519' }, false, ['verify'])
          .then(function (key) {
            return crypto.subtle.verify('Ed25519', key, sigBytes, new TextEncoder().encode(payload));
          });
      })
      .then(function (valid) {
        if (valid) {
          show(ok, 'inline-flex');
        } else {
          msg.textContent = 'signature invalid';
          show(msg, 'inline');
        }
      })
      .catch(function () {
        msg.textContent = 'verification unavailable in this browser';
        show(msg, 'inline');
      });
  });
})();`;

export function VerifyPage(props: VerifyProps) {
  const { owner, repo, isPrivate, certSerial, collectedAt, signature, stats, backLink } = props;
  const sigShort = `${signature.slice(0, 4)}…${signature.slice(-4)}`;
  return (
    <CertFrame
      owner={owner}
      repo={repo}
      title={`${owner}/${repo} — GitCert attestation`}
      backLink={backLink}
    >
      <div class="px-5 pt-6 pb-7 sm:px-[44px] sm:pt-[34px] sm:pb-10">
        <div class="flex items-start justify-between">
          <CardBrand />
          <div class="text-right font-mono">
            <div class="text-[10px] tracking-[1.5px] text-muted uppercase">Attestation</div>
            <div class="mt-[3px] text-[15px] tracking-[0.5px]"># {certSerial}</div>
          </div>
        </div>
        <div class="my-6 h-px bg-hair" />

        <h1 class="mb-1 text-[21px] font-medium tracking-[-0.3px] sm:text-[27px]">
          Attestation of Repository Activity
        </h1>
        <div class="mb-[26px] font-mono text-[12px] text-muted">
          Independently read from GitHub.
        </div>

        <div class="mb-[26px] grid grid-cols-[104px_1fr] gap-x-[14px] gap-y-[11px] font-mono sm:grid-cols-[150px_1fr] sm:gap-x-5 sm:gap-y-[13px] text-[13.5px]">
          <div class="text-muted">repository</div>
          <div>
            {owner}/{repo}
            {' '}
            <span class="text-muted">({isPrivate ? 'private' : 'public'})</span>
          </div>
          <div class="text-muted">owner</div>
          <div class="flex items-center gap-2">@{owner}</div>
        </div>

        <div class="mb-5 h-px bg-hair2" />

        <div class="mb-[26px] grid grid-cols-[104px_1fr] gap-x-[14px] gap-y-[11px] font-mono sm:grid-cols-[150px_1fr] sm:gap-x-5 sm:gap-y-[13px] text-[14px]">
          <div class="text-muted">commits</div>
          <div>
            <span>{formatCount(stats.commits)}</span>
            {' '}
            <span class="text-muted">on default branch</span>
          </div>
          <div class="text-muted">last commit</div>
          <div>{formatFullDate(stats.lastCommitAt)}</div>
          <div class="text-muted">created</div>
          <div>{formatFullDate(stats.repoCreatedAt)}</div>
          <div class="text-muted">first commit</div>
          <div>{formatFullDate(stats.firstCommitAt)}</div>
          <div class="text-muted">open issues</div>
          <div>{formatCount(stats.openIssues)}</div>
          <div class="text-muted">open PRs</div>
          <div>{formatCount(stats.openPrs)}</div>
          <div class="text-muted">language</div>
          <div>
            {stats.primaryLanguage ?? '—'}
            {stats.primaryLanguage !== null && stats.languagePct !== null ? (
              <span class="text-muted"> {Math.round(stats.languagePct)}%</span>
            ) : null}
          </div>
          <div class="text-muted">size</div>
          <div>{formatSizeKb(stats.sizeKb)}</div>
        </div>

        <div class="mb-5 h-px bg-hair2" />

        <div class="mb-2 grid grid-cols-[104px_1fr] gap-x-[14px] gap-y-[11px] font-mono sm:grid-cols-[150px_1fr] sm:gap-x-5 sm:gap-y-[13px] text-[13.5px]">
          <div class="text-muted">attested</div>
          <div>{formatTimestampUtc(collectedAt)}</div>
          <div class="text-muted">method</div>
          <div>
            GitHub App · read-only <a href={GITHUB_REPO_URL}>↗</a>
          </div>
          <div class="text-muted">signature</div>
          <div class="flex flex-wrap items-center gap-3">
            <span>
              ed25519{' '}
              {sigShort}
            </span>
            <button
              id="gc-verify-btn"
              class="cursor-pointer rounded-[2px] border border-accent bg-card px-[11px] py-1 font-mono text-[11.5px] text-accent"
            >
              verify
            </button>
            <span id="gc-sig-valid" class="hidden items-center gap-[6px] text-[12.5px] text-accent">
              {raw(sealSvg({ size: 14, kind: 'check', color: 'var(--accent)' }))}
              signature valid
            </span>
            <span id="gc-sig-msg" class="hidden text-[12.5px] text-muted" />
          </div>
        </div>
      </div>

      <div class="border-t border-hair bg-panel2 px-5 py-5 text-[13.5px] leading-[1.6] text-body sm:px-[44px] sm:py-[22px]">
        <span class="mb-2 block font-mono text-[11px] tracking-[1.5px] text-muted uppercase">
          How this works
        </span>
        GitCert reads repository metadata directly from GitHub's API through a read-only App.
        <div class="mt-[10px]">
          <a href={GITHUB_REPO_URL}>Collector is open source ↗</a>
          {' '}·{' '}
          <a href={GITHUB_REPO_URL}>App permissions ↗</a>
        </div>
        <div class="mt-[18px] flex flex-wrap items-center justify-between gap-4 border-t border-hair pt-[18px]">
          <span>Attest your own private repos.</span>
          <a
            data-nav
            href="/dashboard"
            class="rounded-[3px] bg-ink px-5 py-[10px] font-mono text-[13px] tracking-[0.3px] text-paper"
          >
            Create yours
          </a>
        </div>
      </div>

      <script>{raw(VERIFY_SCRIPT)}</script>
    </CertFrame>
  );
}

export function VerifyCollectingPage(props: { owner: string; repo: string; backLink?: boolean }) {
  const { owner, repo, backLink } = props;
  // Constant markup: the collecting badge carries no repo data (theme=auto
  // so it follows the page's prefers-color-scheme).
  const collectingBadge = renderBadge({
    metric: 'commits',
    label: 'commits',
    state: { kind: 'collecting' },
    style: 'flat',
    theme: 'auto',
    title: 'collecting…',
  });
  return (
    <CertFrame
      owner={owner}
      repo={repo}
      title={`${owner}/${repo} — GitCert attestation`}
      backLink={backLink}
    >
      <div class="px-5 pt-6 pb-7 sm:px-[44px] sm:pt-[34px] sm:pb-10">
        <CardBrand />
        <div class="my-6 h-px bg-hair" />
        <div class="flex min-h-[280px] flex-col items-center justify-center pt-9 pb-11 text-center sm:pt-12 sm:pb-14">
          <div class="mb-[26px] inline-flex">{raw(collectingBadge)}</div>
          <div class="font-mono text-[14px] tracking-[-0.1px] text-soft">
            Attestation in progress — first collection running.
          </div>
          <div class="mt-[14px] font-mono text-[12px] text-muted">check back shortly</div>
        </div>
      </div>
    </CertFrame>
  );
}

export function VerifyNotFoundPage(props: { owner: string; repo: string; backLink?: boolean }) {
  const { owner, repo, backLink } = props;
  return (
    <CertFrame owner={owner} repo={repo} title="GitCert — no attestation found" backLink={backLink}>
      <div class="px-5 pt-6 pb-7 sm:px-[44px] sm:pt-[34px] sm:pb-10">
        <CardBrand />
        <div class="my-6 h-px bg-hair" />
        <div class="flex min-h-[280px] flex-col items-center justify-center pt-9 pb-11 text-center sm:pt-12 sm:pb-14">
          <svg width="44" height="44" viewBox="0 0 24 24" class="mb-6 block">
            <circle
              cx="12"
              cy="12"
              r="10"
              fill="none"
              class="stroke-faint"
              stroke-width="1.4"
              stroke-linecap="round"
              stroke-dasharray="2.6 4.2"
            />
          </svg>
          <div class="font-mono text-[14px] tracking-[-0.1px] text-soft">
            No attestation found for {owner}/{repo}.
          </div>
          <div class="mt-7 font-mono text-[12px] text-muted">
            Attest your own work →{' '}
            <a data-nav href="/auth/login" class="text-accent">
              Connect GitHub
            </a>
          </div>
        </div>
      </div>
    </CertFrame>
  );
}

/**
 * Shared certificate frame: page shell, request-URL caption, and card. The
 * single render site for the `← Back to dashboard` link (DRY) — when `backLink`
 * is set it renders once for ALL verify states above the caption. The link is
 * always the generic `/dashboard`, never repo/owner/cause-derived, so a
 * signed-in not-found stays byte-identical across every hidden cause (no
 * existence oracle). Omitting `backLink` produces byte-identical markup to the
 * cookie-less cached path.
 */
function CertFrame(props: {
  owner: string;
  repo: string;
  title: string;
  backLink?: boolean;
  children?: Child;
}) {
  return (
    <Layout title={props.title}>
      <div class="mx-auto max-w-[680px] px-4 pt-8 pb-16 sm:px-7 sm:pt-[52px] sm:pb-24">
        {props.backLink ? (
          <a
            data-nav
            href="/dashboard"
            class="mb-4 inline-flex items-center gap-[6px] pl-[2px] font-mono text-[12.5px] text-muted sm:mb-5"
          >
            ← Back to dashboard
          </a>
        ) : null}
        <div class="mb-[18px] pl-[2px] font-mono text-[11px] break-all text-muted sm:text-[12px]">
          gitcert.harborstack.app/verify/{props.owner}/{props.repo}
        </div>
        <div class="border border-hair-strong bg-card shadow-[0_1px_0_rgba(0,0,0,0.03)]">
          {props.children}
        </div>
      </div>
    </Layout>
  );
}

/** Card-header brand mark (26px seal + wordmark). */
function CardBrand() {
  return (
    <div class="flex items-center gap-[10px]">
      {raw(sealSvg({ size: 26, kind: 'check', color: 'var(--accent)' }))}
      <span class="font-mono text-[19px] font-semibold tracking-[-0.4px]">GitCert</span>
    </div>
  );
}
