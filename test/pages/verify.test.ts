import { describe, expect, it } from 'vitest';
import type { PublicStats } from '../../src/lib/types';
import {
  VerifyCollectingPage,
  VerifyNotFoundPage,
  VerifyPage,
  type VerifyProps,
} from '../../src/pages/verify';

function fixtureStats(overrides: Partial<PublicStats> = {}): PublicStats {
  return {
    commits: 1247,
    lastCommitAt: '2026-07-21T09:12:44Z',
    openIssues: 3,
    openPrs: 2,
    repoCreatedAt: '2023-02-14T08:30:12Z',
    firstCommitAt: '2023-02-14T09:02:57Z',
    sizeKb: 48_128,
    primaryLanguage: 'TypeScript',
    languagePct: 81.2,
    languages: [{ name: 'TypeScript', pct: 81.2 }],
    ...overrides,
  };
}

function fixtureProps(overrides: Partial<VerifyProps> = {}): VerifyProps {
  return {
    owner: 'wnston',
    repo: 'client-platform',
    isPrivate: true,
    certSerial: 'GC-7F2A41',
    collectedAt: '2026-07-22T14:03:00Z',
    signature: 'a41fBASE64SIGNATUREBYTES9c2e',
    stats: fixtureStats(),
    ...overrides,
  };
}

function render(node: unknown): string {
  return String(node);
}

describe('VerifyPage', () => {
  it('renders the certificate header, serial, and repository identity', () => {
    const html = render(VerifyPage(fixtureProps()));
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('GitCert');
    expect(html).toContain('# GC-7F2A41');
    expect(html).toContain('Attestation of Repository Activity');
    expect(html).toContain('wnston/client-platform');
    expect(html).toContain('(private)');
    expect(html).toContain('@wnston');
    expect(html).toContain('gitcert.harborstack.app/verify/wnston/client-platform');
  });

  it('renders all 8 stats rows with SPEC §8 certificate formatting', () => {
    const html = render(VerifyPage(fixtureProps()));
    expect(html).toContain('1,247');
    expect(html).toContain('on default branch');
    expect(html).toContain('Jul 21, 2026');
    expect(html).toContain('Feb 14, 2023');
    expect(html).toContain('open issues');
    expect(html).toContain('open PRs');
    expect(html).toContain('TypeScript');
    expect(html).toContain('81%');
    expect(html).toContain('47 MB');
  });

  it('renders attested timestamp, method, and shortened signature', () => {
    const html = render(VerifyPage(fixtureProps()));
    expect(html).toContain('Jul 22 2026, 14:03 UTC');
    expect(html).toContain('GitHub App · read-only');
    expect(html).toContain('a41f…9c2e');
    expect(html).not.toContain('a41fBASE64SIGNATUREBYTES9c2e');
  });

  it('marks public repos as public', () => {
    const html = render(VerifyPage(fixtureProps({ isPrivate: false })));
    expect(html).toContain('(public)');
  });

  it('includes the inline verify script and the canonical seal', () => {
    const html = render(VerifyPage(fixtureProps()));
    expect(html).toContain('gc-verify-btn');
    expect(html).toContain("importKey('raw'");
    // The canonical CardBrand seal is untouched by the button restructure.
    expect(html).toContain('m9 12 2 2 4-4');
    expect(html).toContain('data-seal-check');
  });
});

/**
 * The verify button's motion is driven by the REAL Ed25519 verification
 * promise. The design mock faked it with a 900ms setTimeout; porting that
 * would have made the page assert a result it never checked.
 */
describe('VerifyPage verify button (promise-driven)', () => {
  /** The inline VERIFY_SCRIPT body. */
  function script(html: string): string {
    const at = html.indexOf("document.getElementById('gc-verify-btn')");
    return html.slice(html.lastIndexOf('<script>', at), html.indexOf('</script>', at));
  }

  it('renders the three phase faces as static markup inside the button', () => {
    const html = render(VerifyPage(fixtureProps()));
    const btn = html.slice(html.indexOf('id="gc-verify-btn"'), html.indexOf('id="gc-sig-msg"'));
    expect(btn).toContain('data-verify-icon="loading"');
    expect(btn).toContain('data-gc-spin');
    expect(btn).toContain('data-verify-icon="done"');
    expect(btn).toContain('data-gc-check');
    expect(btn).toContain('M4 12 9 17L20 6');
    expect(btn).toContain('data-verify-idle');
    expect(btn).toContain('>verify<');
    expect(btn).toContain('data-verify-valid');
    expect(btn).toContain('>valid<');
  });

  it('drops the separate "signature valid" pill (the check now lives in the button)', () => {
    const html = render(VerifyPage(fixtureProps()));
    expect(html).not.toContain('gc-sig-valid');
    expect(html).not.toContain('signature valid');
    // The failure/unavailable message target stays.
    expect(html).toContain('id="gc-sig-msg"');
  });

  it('sets loading synchronously on click and done ONLY from a true verification', () => {
    const s = script(render(VerifyPage(fixtureProps())));
    expect(s).toContain("btn.setAttribute('data-verify-phase', 'loading')");
    expect(s).toContain("if (valid) btn.setAttribute('data-verify-phase', 'done')");
    // No faked timer anywhere — the mock's 900ms lie must not be ported.
    expect(s).not.toContain('setTimeout');
    expect(s).not.toContain('900');
  });

  it('returns to idle on an invalid signature and on a failed fetch', () => {
    const s = script(render(VerifyPage(fixtureProps())));
    // Both failure paths clear the phase, so the button is re-clickable and
    // never shows the check — there is no guaranteed-valid outcome.
    expect(s).toContain("btn.removeAttribute('data-verify-phase')");
    expect(s).toContain("fail('signature invalid')");
    expect(s).toContain("fail('verification unavailable in this browser')");
  });

  it('guards re-entry while loading or already done', () => {
    const s = script(render(VerifyPage(fixtureProps())));
    expect(s).toContain("if (btn.hasAttribute('data-verify-phase')) return;");
  });

  it('slices the signed bytes verbatim — never a JSON round-trip', () => {
    const s = script(render(VerifyPage(fixtureProps())));
    // Byte-identical to the shipped line. Re-serializing a parsed payload
    // reorders/reformats and fails a genuine certificate (attestation rule).
    expect(s).toContain(
      `var payload = envelope.slice('{"payload":'.length, envelope.lastIndexOf(',"signature"'));`,
    );
    expect(s).not.toContain('JSON.stringify');
    // The real WebCrypto path is untouched.
    expect(s).toContain("crypto.subtle.verify('Ed25519'");
    expect(s).toContain('results[1].public_key');
    expect(s).toContain("fetch('/pubkey')");
  });

  it('is a constant script — no user data reaches it', () => {
    const s = script(render(VerifyPage(fixtureProps({ owner: 'evil-owner', repo: 'evil-repo' }))));
    expect(s).not.toContain('evil-owner');
    expect(s).not.toContain('evil-repo');
    // owner/repo are read from the URL at runtime instead.
    expect(s).toContain('location.pathname.split');
  });

  it('escapes user-controlled strings', () => {
    const html = render(
      VerifyPage(
        fixtureProps({
          owner: '<script>alert(1)</script>',
          repo: 'a&b"c',
          stats: fixtureStats({ primaryLanguage: '<img src=x>' }),
        }),
      ),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x>');
  });

  it('degrades gracefully when nullable stats are missing', () => {
    const html = render(
      VerifyPage(
        fixtureProps({
          stats: fixtureStats({
            lastCommitAt: null,
            firstCommitAt: null,
            sizeKb: null,
            primaryLanguage: null,
            languagePct: null,
          }),
        }),
      ),
    );
    expect(html).toContain('—');
    expect(html).not.toContain('null');
  });
});

describe('VerifyPage responsive breakpoints (mobile spec)', () => {
  it('narrows all three stat grids at base and restores desktop columns at sm', () => {
    const html = render(VerifyPage(fixtureProps()));
    expect(html.match(/grid-cols-\[104px_1fr\]/g)).toHaveLength(3);
    expect(html.match(/sm:grid-cols-\[150px_1fr\]/g)).toHaveLength(3);
  });

  it('lets the request-URL caption break on narrow screens', () => {
    const html = render(VerifyPage(fixtureProps()));
    const captionStart = html.indexOf('gitcert.harborstack.app/verify/');
    const captionTag = html.slice(html.lastIndexOf('<div', captionStart), captionStart);
    expect(captionTag).toContain('break-all');
  });
});

describe('VerifyCollectingPage', () => {
  it('renders the collecting badge and progress copy', () => {
    const html = render(VerifyCollectingPage({ owner: 'wnston', repo: 'some-repo' }));
    expect(html).toContain('collecting…');
    expect(html).toContain('gcpulse');
    expect(html).toContain('Attestation in progress — first collection running.');
    expect(html).toContain('check back shortly');
    expect(html).toContain('gitcert.harborstack.app/verify/wnston/some-repo');
  });

  it('carries no stats, serial, or verify script', () => {
    const html = render(VerifyCollectingPage({ owner: 'wnston', repo: 'some-repo' }));
    expect(html).not.toContain('# GC-');
    expect(html).not.toContain('gc-verify-btn');
  });

  it('escapes user-controlled strings', () => {
    const html = render(VerifyCollectingPage({ owner: '<b>x</b>', repo: 'r' }));
    expect(html).not.toContain('<b>x</b>');
  });
});

describe('VerifyNotFoundPage', () => {
  it('renders the cause-blind empty state', () => {
    const html = render(VerifyNotFoundPage({ owner: 'wnston', repo: 'some-repo' }));
    expect(html).toContain('No attestation found for wnston/some-repo.');
    expect(html).toContain('stroke-dasharray="2.6 4.2"');
    expect(html).toContain('Connect GitHub');
  });

  it('carries no stats, serial, or verify script', () => {
    const html = render(VerifyNotFoundPage({ owner: 'wnston', repo: 'some-repo' }));
    expect(html).not.toContain('# GC-');
    expect(html).not.toContain('gc-verify-btn');
  });

  it('escapes user-controlled strings', () => {
    const html = render(VerifyNotFoundPage({ owner: 'o', repo: '"><svg onload=x>' }));
    expect(html).not.toContain('"><svg onload=x>');
  });
});

/** The `← Back to dashboard` anchor substring, or '' when absent. */
function backLinkAnchor(html: string): string {
  const marker = '← Back to dashboard';
  const i = html.indexOf(marker);
  if (i === -1) return '';
  return html.slice(html.lastIndexOf('<a', i), html.indexOf('</a>', i) + 4);
}

describe('Verify back-to-dashboard link (issue #3, verify half)', () => {
  const collecting = (backLink?: boolean) =>
    render(VerifyCollectingPage({ owner: 'wnston', repo: 'r', backLink }));
  const notFound = (backLink?: boolean, owner = 'wnston', repo = 'r') =>
    render(VerifyNotFoundPage({ owner, repo, backLink }));
  const certificate = (backLink?: boolean) => render(VerifyPage(fixtureProps({ backLink })));

  it('renders the back-link on ALL THREE states when backLink is set (D1)', () => {
    for (const html of [certificate(true), collecting(true), notFound(true)]) {
      expect(html).toContain('← Back to dashboard');
      expect(backLinkAnchor(html)).toContain('href="/dashboard"');
    }
  });

  it('omits the back-link (byte-identical to today) when backLink is absent/false', () => {
    // The cookie-less cached path depends on this: default markup is unchanged.
    for (const html of [certificate(), collecting(), notFound()]) {
      expect(html).not.toContain('← Back to dashboard');
    }
    // An explicit false is identical to omitting it entirely.
    expect(certificate(false)).toBe(certificate());
    expect(collecting(false)).toBe(collecting());
    expect(notFound(false)).toBe(notFound());
  });

  it('links the GENERIC /dashboard on not-found, never repo/owner-derived (no oracle)', () => {
    const anchor = backLinkAnchor(notFound(true, 'someowner', 'somerepo'));
    expect(anchor).toContain('href="/dashboard"');
    expect(anchor).not.toContain('someowner');
    expect(anchor).not.toContain('somerepo');
  });

  it('renders a cause-independent back-link — identical across different repos', () => {
    // The link is the same bytes no matter which (hidden) repo the viewer hit,
    // so a signed-in not-found leaks nothing about which repo exists.
    const a = backLinkAnchor(notFound(true, 'alpha', 'one'));
    const b = backLinkAnchor(notFound(true, 'beta', 'two'));
    expect(a).toBe(b);
    expect(a).not.toBe('');
  });
});

describe('VerifyPage footer (shared shell)', () => {
  it('renders the site footer', () => {
    const html = render(VerifyPage(fixtureProps()));
    expect(html).toContain('<footer');
    // Attribution is its own centered grid cell now (no ' · ' concatenation).
    expect(html).toContain('Built by');
  });
});
