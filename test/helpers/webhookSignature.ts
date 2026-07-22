/** Test-only helper: computes a real `X-Hub-Signature-256` header value for a raw body string. */
export async function signWebhookBody(rawBody: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const hex = Array.from(new Uint8Array(mac), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
  return `sha256=${hex}`;
}
