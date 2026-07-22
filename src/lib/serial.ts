/**
 * Deterministic certificate serial derivation (SPEC.md §4, §7).
 *
 * `cert_serial = "GC-" + first 6 uppercase hex chars of
 * SHA-256(repo_id || collected_at)`. Pure and deterministic: no counters, no
 * randomness — the same (repoId, collectedAt) pair always yields the same
 * serial (architectures/attestation).
 */
export async function computeCertSerial(repoId: number, collectedAt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${repoId}${collectedAt}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
  return `GC-${hex.slice(0, 6).toUpperCase()}`;
}
