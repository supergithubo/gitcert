import { describe, expect, it } from 'vitest';
import { computeCertSerial } from '../../src/lib/serial';

describe('computeCertSerial', () => {
  it('is deterministic for the same repo id and collected_at (happy path)', async () => {
    const first = await computeCertSerial(123456, '2026-07-22T14:03:00Z');
    const second = await computeCertSerial(123456, '2026-07-22T14:03:00Z');
    expect(first).toBe(second);
  });

  it('matches the "GC-" + 6 uppercase hex chars format', async () => {
    const serial = await computeCertSerial(1, '2026-01-01T00:00:00Z');
    expect(serial).toMatch(/^GC-[0-9A-F]{6}$/);
  });

  it('produces different serials for different collected_at values (edge case)', async () => {
    const first = await computeCertSerial(1, '2026-01-01T00:00:00Z');
    const second = await computeCertSerial(1, '2026-01-01T00:00:01Z');
    expect(first).not.toBe(second);
  });

  it('produces different serials for different repo ids given the same timestamp', async () => {
    const first = await computeCertSerial(1, '2026-01-01T00:00:00Z');
    const second = await computeCertSerial(2, '2026-01-01T00:00:00Z');
    expect(first).not.toBe(second);
  });
});
