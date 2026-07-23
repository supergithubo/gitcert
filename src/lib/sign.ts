/**
 * Ed25519 signing/verification for the canonical attestation payload
 * (SPEC.md §7), via `crypto.subtle` only — never a Node crypto polyfill.
 *
 * `SIGNING_KEY` is a base64-encoded raw 32-byte Ed25519 seed. WebCrypto has
 * no "raw seed" private-key import format, so the seed is wrapped in its
 * fixed (seed-only) PKCS#8 DER envelope before import. The corresponding
 * public key is derived once via JWK export/import — it is never stored
 * separately, only ever recomputed from the same seed.
 */

// Fixed 16-byte PKCS#8 prefix for an Ed25519 private key (RFC 8410) —
// everything but the 32-byte seed is constant, so this is a compile-time
// constant, not a secret.
const PKCS8_ED25519_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);
const ED25519_SEED_LENGTH = 32;

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function seedToPkcs8(seed: Uint8Array): Uint8Array {
  const der = new Uint8Array(PKCS8_ED25519_PREFIX.length + seed.length);
  der.set(PKCS8_ED25519_PREFIX, 0);
  der.set(seed, PKCS8_ED25519_PREFIX.length);
  return der;
}

async function importSigningKeyPair(seedBase64: string): Promise<CryptoKeyPair> {
  const seed = base64ToBytes(seedBase64);
  if (seed.length !== ED25519_SEED_LENGTH) {
    throw new Error(`SIGNING_KEY must decode to a ${ED25519_SEED_LENGTH}-byte Ed25519 seed`);
  }
  const privateKey = await crypto.subtle.importKey('pkcs8', seedToPkcs8(seed), 'Ed25519', true, [
    'sign',
  ]);
  const jwk = (await crypto.subtle.exportKey('jwk', privateKey)) as JsonWebKey;
  if (!jwk.x) {
    throw new Error('Failed to derive Ed25519 public key from signing seed');
  }
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'OKP', crv: 'Ed25519', x: jwk.x },
    'Ed25519',
    true,
    ['verify'],
  );
  return { privateKey, publicKey };
}

/** Signs the exact UTF-8 bytes of `payloadJson` with Ed25519, returning a base64 signature. */
export async function sign(payloadJson: string, seedBase64: string): Promise<string> {
  const { privateKey } = await importSigningKeyPair(seedBase64);
  const signature = await crypto.subtle.sign(
    'Ed25519',
    privateKey,
    new TextEncoder().encode(payloadJson),
  );
  return bytesToBase64(new Uint8Array(signature));
}

/**
 * Derives the Ed25519 public key from `SIGNING_KEY` at request time (no
 * persistence, no GitHub) — backs `GET /pubkey`. Returns both the raw
 * 32-byte key (base64) and its JWK form so the route can serve either
 * representation without a second key derivation.
 */
export async function derivePublicKey(
  seedBase64: string,
): Promise<{ raw: string; jwk: JsonWebKey }> {
  const { publicKey } = await importSigningKeyPair(seedBase64);
  const rawBytes = (await crypto.subtle.exportKey('raw', publicKey)) as ArrayBuffer;
  const jwk = (await crypto.subtle.exportKey('jwk', publicKey)) as JsonWebKey;
  return { raw: bytesToBase64(new Uint8Array(rawBytes)), jwk };
}

/** Verifies a base64 signature against `payloadJson` using the public key derived from `seedBase64`. */
export async function verify(
  payloadJson: string,
  signatureBase64: string,
  seedBase64: string,
): Promise<boolean> {
  const { publicKey } = await importSigningKeyPair(seedBase64);
  return crypto.subtle.verify(
    'Ed25519',
    publicKey,
    base64ToBytes(signatureBase64),
    new TextEncoder().encode(payloadJson),
  );
}
