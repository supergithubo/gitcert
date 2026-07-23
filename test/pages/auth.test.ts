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
