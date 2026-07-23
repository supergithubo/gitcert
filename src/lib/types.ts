/**
 * Shared domain shapes used across the collector, signing pipeline, and D1
 * access layer. Kept separate from `db.ts` so `payload.ts` and
 * `collector/query.ts` do not need to import SQL-adjacent row types.
 */

/** One entry of a repo's top-5 language breakdown (SPEC.md §7). */
export interface LanguageShare {
  name: string;
  pct: number;
}

/**
 * The stats a public surface (badge/API/verify) is allowed to render —
 * shared between `src/lib/db.ts` (produces it from a D1 read) and
 * `src/badges/value.ts` / `src/pages/verify.tsx` (pure consumers, per the
 * M2 spec's frozen Interface Contract). Field names are camelCase mirrors
 * of the `stats` table columns (SPEC.md §4).
 */
export interface PublicStats {
  commits: number;
  lastCommitAt: string | null;
  openIssues: number;
  openPrs: number;
  repoCreatedAt: string | null;
  firstCommitAt: string | null;
  sizeKb: number | null;
  primaryLanguage: string | null;
  languagePct: number | null;
  languages: LanguageShare[];
}
