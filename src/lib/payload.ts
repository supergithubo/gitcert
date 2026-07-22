import type { LanguageShare } from './types';

const ISSUER = 'gitcert.harborstack.app';
const METHOD = 'github-app/read-only';
const PAYLOAD_VERSION = 1;

export interface CanonicalStatsInput {
  commits: number;
  createdAt: string | null;
  firstCommitAt: string | null;
  languagePct: number | null;
  languages: LanguageShare[];
  lastCommitAt: string | null;
  openIssues: number;
  openPrs: number;
  primaryLanguage: string | null;
  sizeKb: number | null;
}

export interface CanonicalPayloadInput {
  certSerial: string;
  collectedAt: string;
  repo: string;
  private: boolean;
  stats: CanonicalStatsInput;
}

/**
 * Builds the canonical v1 attestation payload (SPEC.md §7): a JSON string
 * with object keys sorted alphabetically at every level and no whitespace.
 * These are the exact bytes that get signed and stored — the result must
 * never be re-parsed and re-serialized on read (architectures/attestation).
 */
export function buildCanonicalPayload(input: CanonicalPayloadInput): string {
  const payload = {
    cert_serial: input.certSerial,
    collected_at: input.collectedAt,
    issuer: ISSUER,
    method: METHOD,
    private: input.private,
    repo: input.repo,
    stats: {
      commits: input.stats.commits,
      created_at: input.stats.createdAt,
      first_commit_at: input.stats.firstCommitAt,
      language_pct: input.stats.languagePct,
      languages: input.stats.languages.map((language) => ({
        name: language.name,
        pct: language.pct,
      })),
      last_commit_at: input.stats.lastCommitAt,
      open_issues: input.stats.openIssues,
      open_prs: input.stats.openPrs,
      primary_language: input.stats.primaryLanguage,
      size_kb: input.stats.sizeKb,
    },
    v: PAYLOAD_VERSION,
  };
  return JSON.stringify(sortKeysDeep(payload));
}

/** Recursively rebuilds objects with alphabetically sorted keys; arrays and primitives pass through unchanged. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const sorted: Record<string, unknown> = {};
    for (const [key, entryValue] of entries) {
      sorted[key] = sortKeysDeep(entryValue);
    }
    return sorted;
  }
  return value;
}
