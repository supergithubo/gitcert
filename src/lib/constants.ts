/**
 * Small, stable, cross-cutting constants with no other natural home.
 * `rules/library/architectures/rest-api`/`stacks/hono`: routes never import
 * from `src/pages/`, so a constant needed by both a route (`src/routes/api.ts`)
 * and pages (`src/pages/layout.tsx` and its consumers) lives here instead of
 * on a page module (spec overview §Step 2). Extend this module for future
 * shared constants rather than creating a second one — parity over novelty.
 */

/** Canonical public repo URL — same value used everywhere gitcert links to its own source. */
export const GITHUB_REPO_URL = 'https://github.com/supergithubo/gitcert';
