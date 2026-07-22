/**
 * GitHub webhook HMAC-SHA256 verification (`X-Hub-Signature-256`).
 *
 * Must run against the raw request body bytes BEFORE any JSON parsing
 * (rules/library/architectures/rest-api, security.md SEC-001) — a mismatch
 * or missing signature is a 401 with no further detail leaked.
 */

const SIGNATURE_PREFIX = 'sha256=';

/** Verifies `signatureHeader` (the raw `X-Hub-Signature-256` value) against `rawBody` using `secret`. */
export async function verifyGithubSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader || !signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }
  const provided = signatureHeader.slice(SIGNATURE_PREFIX.length);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(mac), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return timingSafeEqual(expected, provided);
}

/** Constant-time string comparison — avoids leaking match length via early return timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
