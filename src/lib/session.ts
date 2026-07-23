/**
 * Owner session (`gc_session`) and OAuth state-nonce (`gc_oauth_state`)
 * cookies — spec overview §Route contracts "Session cookie". Stateless
 * HMAC-SHA256 cookies, no server-side session store (headline decision 1).
 *
 * Session cookie value: `base64url(payloadJson) + "." + base64url(HMAC)`.
 * Verification is structural parse → timing-safe MAC compare → `exp` check;
 * any failure is treated as signed out (never throws).
 */

const TEXT_ENCODER = new TextEncoder();

export const SESSION_COOKIE_NAME = 'gc_session';
export const STATE_COOKIE_NAME = 'gc_oauth_state';

const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days
const STATE_MAX_AGE_SECONDS = 600; // 10 minutes

/** Shared attributes for both owner-flow cookies (spec overview §Route contracts). */
const COOKIE_ATTRIBUTES = 'HttpOnly; Secure; SameSite=Lax; Path=/';

/** Decoded, verified session payload. */
export interface SessionPayload {
  githubId: number;
  login: string;
  /** Unix seconds. */
  exp: number;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = atob(padded + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Constant-time string comparison — avoids leaking match length via early return timing (mirrors `lib/webhookSignature.ts`). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    TEXT_ENCODER.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, TEXT_ENCODER.encode(message));
  return new Uint8Array(mac);
}

/**
 * Signs `{ githubId, login, exp: now + 7d }` into the `gc_session` cookie
 * value and returns the full `Set-Cookie` header string (name, value, and
 * every attribute from the contract).
 */
export async function createSessionCookie(
  input: { githubId: number; login: string },
  secret: string,
  now: () => Date = () => new Date(),
): Promise<string> {
  const exp = Math.floor(now().getTime() / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload: SessionPayload = { githubId: input.githubId, login: input.login, exp };
  const payloadEncoded = base64UrlEncode(TEXT_ENCODER.encode(JSON.stringify(payload)));
  const mac = await hmacSha256(secret, payloadEncoded);
  const value = `${payloadEncoded}.${base64UrlEncode(mac)}`;
  return `${SESSION_COOKIE_NAME}=${value}; ${COOKIE_ATTRIBUTES}; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

/**
 * Verifies a raw `gc_session` cookie value (just the value, not the whole
 * `Cookie` header) — structural parse, timing-safe MAC compare, then `exp`
 * check. Returns `null` on any failure; never throws.
 */
export async function verifySessionCookie(
  cookieValue: string | undefined | null,
  secret: string,
  now: () => Date = () => new Date(),
): Promise<SessionPayload | null> {
  if (!cookieValue) return null;
  const separatorIndex = cookieValue.indexOf('.');
  if (separatorIndex === -1) return null;
  const payloadEncoded = cookieValue.slice(0, separatorIndex);
  const providedMac = cookieValue.slice(separatorIndex + 1);

  const expectedMac = base64UrlEncode(await hmacSha256(secret, payloadEncoded));
  if (!timingSafeEqual(expectedMac, providedMac)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadEncoded)));
  } catch {
    return null;
  }
  if (!isSessionPayload(parsed)) return null;
  if (parsed.exp <= Math.floor(now().getTime() / 1000)) return null;
  return parsed;
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.githubId === 'number' &&
    typeof record.login === 'string' &&
    typeof record.exp === 'number'
  );
}

/** `Set-Cookie` header string clearing `gc_session` (`Max-Age=0`). */
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;
}

/**
 * Generates a fresh 32-byte random state nonce (base64url) and the
 * `Set-Cookie` header string that stores it in `gc_oauth_state` for the
 * CSRF round-trip through GitHub's authorize redirect (10-minute TTL).
 */
export function createStateCookie(): { nonce: string; setCookieHeader: string } {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const nonce = base64UrlEncode(bytes);
  const setCookieHeader = `${STATE_COOKIE_NAME}=${nonce}; ${COOKIE_ATTRIBUTES}; Max-Age=${STATE_MAX_AGE_SECONDS}`;
  return { nonce, setCookieHeader };
}

/** Timing-safe comparison of the callback's `state` query param against the `gc_oauth_state` cookie value. */
export function verifyState(
  stateParam: string | undefined | null,
  cookieValue: string | undefined | null,
): boolean {
  if (!stateParam || !cookieValue) return false;
  return timingSafeEqual(stateParam, cookieValue);
}

/** `Set-Cookie` header string clearing `gc_oauth_state` (`Max-Age=0`). */
export function clearStateCookie(): string {
  return `${STATE_COOKIE_NAME}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;
}
