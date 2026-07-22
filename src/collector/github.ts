/**
 * GitHub App authentication: mints a short-lived App JWT (RS256) and
 * exchanges it for a 1-hour installation access token. Tokens are returned
 * to the caller and never persisted or logged — they live only inside a
 * single collector run (architectures/attestation, cloudflare-workers rules).
 */

export const GITHUB_USER_AGENT = 'gitcert-collector (+https://gitcert.harborstack.app)';

const APP_JWT_BACKDATE_SECONDS = 60;
const APP_JWT_LIFETIME_SECONDS = 600;

export interface InstallationToken {
  token: string;
  expiresAt: string;
}

function pemToDer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function base64UrlEncode(input: string | Uint8Array): string {
  const binary = typeof input === 'string' ? input : String.fromCharCode(...input);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Mints a GitHub App JWT (RS256, `iss = appId`, 10-minute expiry, minted fresh per call). */
export async function createAppJwt(
  appId: string,
  privateKeyPem: string,
  now: () => Date,
): Promise<string> {
  const nowSeconds = Math.floor(now().getTime() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iat: nowSeconds - APP_JWT_BACKDATE_SECONDS,
    exp: nowSeconds + APP_JWT_LIFETIME_SECONDS,
    iss: appId,
  };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Exchanges an App JWT for a 1-hour installation access token. Returns
 * `null` (never throws) on a non-200 response so the caller can log and
 * skip this installation without failing the whole cron run.
 */
export async function mintInstallationToken(
  appId: string,
  privateKeyPem: string,
  installationId: number,
  now: () => Date = () => new Date(),
): Promise<InstallationToken | null> {
  const jwt = await createAppJwt(appId, privateKeyPem, now);
  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': GITHUB_USER_AGENT,
      },
    },
  );
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as { token: string; expires_at: string };
  return { token: body.token, expiresAt: body.expires_at };
}
