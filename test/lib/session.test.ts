import { describe, expect, it } from 'vitest';
import {
  SESSION_COOKIE_NAME,
  STATE_COOKIE_NAME,
  clearSessionCookie,
  clearStateCookie,
  createSessionCookie,
  createStateCookie,
  verifySessionCookie,
  verifyState,
} from '../../src/lib/session';

const SECRET = 'test-session-secret';

function extractValue(setCookieHeader: string, name: string): string {
  const match = setCookieHeader.match(new RegExp(`^${name}=([^;]*);`));
  if (!match?.[1]) throw new Error(`cookie ${name} not found in header: ${setCookieHeader}`);
  return match[1];
}

describe('session.ts', () => {
  describe('createSessionCookie / verifySessionCookie', () => {
    it('round-trips a valid session (happy path)', async () => {
      const now = () => new Date('2026-07-23T00:00:00Z');
      const header = await createSessionCookie({ githubId: 42, login: 'wnston' }, SECRET, now);

      expect(header).toContain(`${SESSION_COOKIE_NAME}=`);
      expect(header).toContain('HttpOnly');
      expect(header).toContain('Secure');
      expect(header).toContain('SameSite=Lax');
      expect(header).toContain('Path=/');
      expect(header).toContain('Max-Age=604800');

      const value = extractValue(header, SESSION_COOKIE_NAME);
      const payload = await verifySessionCookie(value, SECRET, now);
      expect(payload).toEqual({ githubId: 42, login: 'wnston', exp: expect.any(Number) });
    });

    it('rejects a tampered MAC (permission boundary — session forgery)', async () => {
      const now = () => new Date('2026-07-23T00:00:00Z');
      const header = await createSessionCookie({ githubId: 42, login: 'wnston' }, SECRET, now);
      const value = extractValue(header, SESSION_COOKIE_NAME);
      const [payloadEncoded] = value.split('.');
      const tampered = `${payloadEncoded}.wrongmac000000000000000000000000000000000`;

      const payload = await verifySessionCookie(tampered, SECRET, now);
      expect(payload).toBeNull();
    });

    it('rejects a tampered payload with a valid-shaped MAC (permission boundary — session forgery)', async () => {
      const now = () => new Date('2026-07-23T00:00:00Z');
      const aliceHeader = await createSessionCookie({ githubId: 1, login: 'alice' }, SECRET, now);
      const bobHeader = await createSessionCookie({ githubId: 2, login: 'bob' }, SECRET, now);
      const [, aliceMac] = extractValue(aliceHeader, SESSION_COOKIE_NAME).split('.');
      const [bobPayload] = extractValue(bobHeader, SESSION_COOKIE_NAME).split('.');

      // Swap bob's payload onto alice's MAC — payload/signature mismatch.
      const forged = `${bobPayload}.${aliceMac}`;
      const payload = await verifySessionCookie(forged, SECRET, now);
      expect(payload).toBeNull();
    });

    it('rejects an expired session (permission boundary — session forgery)', async () => {
      const issuedAt = () => new Date('2026-07-01T00:00:00Z');
      const header = await createSessionCookie({ githubId: 42, login: 'wnston' }, SECRET, issuedAt);
      const value = extractValue(header, SESSION_COOKIE_NAME);

      const eightDaysLater = () => new Date('2026-07-09T00:00:01Z');
      const payload = await verifySessionCookie(value, SECRET, eightDaysLater);
      expect(payload).toBeNull();
    });

    it('rejects a malformed cookie value with no separator (error path)', async () => {
      const payload = await verifySessionCookie('not-a-valid-cookie-value', SECRET);
      expect(payload).toBeNull();
    });

    it('rejects a missing cookie value (edge case)', async () => {
      const payload = await verifySessionCookie(undefined, SECRET);
      expect(payload).toBeNull();
    });

    it('rejects a session signed with a different secret (permission boundary)', async () => {
      const now = () => new Date('2026-07-23T00:00:00Z');
      const header = await createSessionCookie({ githubId: 42, login: 'wnston' }, SECRET, now);
      const value = extractValue(header, SESSION_COOKIE_NAME);
      const payload = await verifySessionCookie(value, 'a-different-secret', now);
      expect(payload).toBeNull();
    });
  });

  describe('clearSessionCookie', () => {
    it('clears the session cookie with Max-Age=0', () => {
      const header = clearSessionCookie();
      expect(header).toContain(`${SESSION_COOKIE_NAME}=;`);
      expect(header).toContain('Max-Age=0');
    });
  });

  describe('createStateCookie / verifyState', () => {
    it('generates a nonce and matching Set-Cookie header (happy path)', () => {
      const { nonce, setCookieHeader } = createStateCookie();
      expect(nonce.length).toBeGreaterThan(0);
      expect(setCookieHeader).toContain(`${STATE_COOKIE_NAME}=${nonce}`);
      expect(setCookieHeader).toContain('Max-Age=600');
      expect(setCookieHeader).toContain('HttpOnly');
    });

    it('generates distinct nonces on repeated calls (edge case)', () => {
      const first = createStateCookie();
      const second = createStateCookie();
      expect(first.nonce).not.toBe(second.nonce);
    });

    it('verifies a matching state/cookie pair', () => {
      const { nonce } = createStateCookie();
      expect(verifyState(nonce, nonce)).toBe(true);
    });

    it('rejects a mismatched state param (permission boundary — OAuth state mismatch)', () => {
      const { nonce } = createStateCookie();
      expect(verifyState('some-other-value', nonce)).toBe(false);
    });

    it('rejects a missing state param or cookie (error path)', () => {
      const { nonce } = createStateCookie();
      expect(verifyState(undefined, nonce)).toBe(false);
      expect(verifyState(nonce, undefined)).toBe(false);
      expect(verifyState(undefined, undefined)).toBe(false);
    });
  });

  describe('clearStateCookie', () => {
    it('clears the state cookie with Max-Age=0', () => {
      const header = clearStateCookie();
      expect(header).toContain(`${STATE_COOKIE_NAME}=;`);
      expect(header).toContain('Max-Age=0');
    });
  });
});
