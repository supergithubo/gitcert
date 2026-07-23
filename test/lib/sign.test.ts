import { describe, expect, it } from 'vitest';
import { derivePublicKey, sign, verify } from '../../src/lib/sign';

// Fixed synthetic test seed (32 bytes, 1..32) — not a real secret, never
// used outside tests.
const TEST_SEED = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=';

describe('sign / verify', () => {
  it('round-trips: a signature produced by sign() verifies true (happy path)', async () => {
    const payload = '{"cert_serial":"GC-000000"}';
    const signature = await sign(payload, TEST_SEED);
    await expect(verify(payload, signature, TEST_SEED)).resolves.toBe(true);
  });

  it('rejects a signature for tampered payload bytes (error path)', async () => {
    const payload = '{"cert_serial":"GC-000000"}';
    const signature = await sign(payload, TEST_SEED);
    await expect(verify('{"cert_serial":"GC-000001"}', signature, TEST_SEED)).resolves.toBe(false);
  });

  it('throws when SIGNING_KEY does not decode to a 32-byte seed (edge case)', async () => {
    await expect(sign('payload', btoa('too-short'))).rejects.toThrow(/32-byte/);
  });

  it('produces different signatures for different seeds given the same payload', async () => {
    const payload = '{"cert_serial":"GC-000000"}';
    const otherSeed = 'IB8eHRwbGhkYFxYVFBMSERAPDg0MCwoJCAcGBQQDAgE=';
    const signatureA = await sign(payload, TEST_SEED);
    const signatureB = await sign(payload, otherSeed);
    expect(signatureA).not.toBe(signatureB);
  });
});

describe('derivePublicKey', () => {
  it('derives a raw 32-byte key and matching JWK that verify a real signature (happy path)', async () => {
    const { raw, jwk } = await derivePublicKey(TEST_SEED);
    expect(jwk).toMatchObject({ kty: 'OKP', crv: 'Ed25519' });
    expect(typeof jwk.x).toBe('string');

    const rawBytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
    expect(rawBytes.length).toBe(32);

    const publicKey = await crypto.subtle.importKey(
      'jwk',
      { kty: 'OKP', crv: 'Ed25519', x: jwk.x },
      'Ed25519',
      true,
      ['verify'],
    );
    const payload = '{"cert_serial":"GC-000000"}';
    const signature = await sign(payload, TEST_SEED);
    const signatureBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
    await expect(
      crypto.subtle.verify('Ed25519', publicKey, signatureBytes, new TextEncoder().encode(payload)),
    ).resolves.toBe(true);
  });

  it('is deterministic: the same seed always derives the same public key', async () => {
    const first = await derivePublicKey(TEST_SEED);
    const second = await derivePublicKey(TEST_SEED);
    expect(second.raw).toBe(first.raw);
    expect(second.jwk.x).toBe(first.jwk.x);
  });

  it('throws when SIGNING_KEY does not decode to a 32-byte seed (error path)', async () => {
    await expect(derivePublicKey(btoa('too-short'))).rejects.toThrow(/32-byte/);
  });
});
