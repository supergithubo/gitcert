import { describe, expect, it } from 'vitest';
import { AuthErrorPage } from '../../src/pages/auth';

function render(node: unknown): string {
  return String(node);
}

describe('AuthErrorPage', () => {
  it('renders generic failure copy with a retry link to /auth/login', () => {
    const html = render(AuthErrorPage());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('GitCert');
    expect(html).toContain('didn&#39;t complete');
    expect(html).toContain('href="/auth/login"');
    expect(html).toContain('try again');
  });

  it('leaks no OAuth internals (SEC-007)', () => {
    const html = render(AuthErrorPage());
    for (const needle of ['state', 'token', 'code', 'github_id', 'OAuth']) {
      expect(html.toLowerCase()).not.toContain(` ${needle.toLowerCase()} `);
    }
    expect(html).not.toContain('client_id');
  });
});

describe('AuthErrorPage responsive card (verify-certificate parity)', () => {
  it('takes the CertFrame responsive deltas', () => {
    const html = render(AuthErrorPage());
    expect(html).toContain('px-4 pt-8 pb-16 sm:px-7 sm:pt-[52px] sm:pb-24');
    expect(html).toContain('px-5 pt-6 pb-7 sm:px-[44px] sm:pt-[34px] sm:pb-10');
  });
});

describe('SignedOutPage retirement (third export)', () => {
  it('is no longer exported — logout 302s to the signed-out landing instead', async () => {
    const mod = await import('../../src/pages/auth');
    expect('SignedOutPage' in mod).toBe(false);
  });
});

describe('Auth pages footer (shared shell)', () => {
  it('renders the site footer on the auth page', () => {
    const html = render(AuthErrorPage());
    expect(html).toContain('<footer');
    expect(html).toContain('· Built by ');
  });
});
