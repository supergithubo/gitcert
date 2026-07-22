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
