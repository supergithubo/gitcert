import { describe, expect, it } from 'vitest';
import { AuthErrorPage, SignedOutPage } from '../../src/pages/auth';

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

describe('Auth pages responsive card (verify-certificate parity)', () => {
  it.each([
    ['AuthErrorPage', AuthErrorPage],
    ['SignedOutPage', SignedOutPage],
  ])('%s takes the CertFrame responsive deltas', (_name, page) => {
    const html = render(page());
    expect(html).toContain('px-4 pt-8 pb-16 sm:px-7 sm:pt-[52px] sm:pb-24');
    expect(html).toContain('px-5 pt-6 pb-7 sm:px-[44px] sm:pt-[34px] sm:pb-10');
  });
});

describe('SignedOutPage', () => {
  it('renders sign-out confirmation with a sign-in link to /auth/login', () => {
    const html = render(SignedOutPage());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('signed out');
    expect(html).toContain('href="/auth/login"');
    expect(html).toContain('sign in');
  });

  it('carries no session or user data (static confirmation page)', () => {
    const html = render(SignedOutPage());
    expect(html).not.toContain('gc_session');
    expect(html).not.toContain('@');
  });
});
