import { describe, expect, it } from 'vitest';
import { sign, verify } from '../../src/lib/sign';

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
