/**
 * Build provenance stamp (spec overview §Step 1). CI (`.github/workflows/deploy.yml`)
 * overwrites this file wholesale via heredoc, IN THE RUNNER ONLY, right
 * before `npm run check`/`npm test` and never commits the rewritten file
 * back to the repo — the checked-in version you are reading is always the
 * `'dev'` sentinel below.
 *
 * `'dev'` means "this code was not built by CI": local `wrangler dev`,
 * `npm run typecheck`, and vitest all see this exact placeholder, and
 * `GET /version` / the footer / `/verify` treat it as "no provenance claim
 * to render" rather than a lie.
 *
 * Holds ONLY this one export. Never add a second export here — the CI
 * heredoc rewrites the whole file, so anything else placed in it would be
 * silently deleted on the next deploy. `GITHUB_REPO_URL` lives in
 * `src/lib/constants.ts` instead for exactly this reason.
 *
 * Explicitly typed (not `as const`) so `commit`/`runId`/`builtAt` are plain
 * `string`, not the literal `'dev'` — every consumer's `BUILD.commit !==
 * 'dev'` check narrows correctly this way, both for this committed
 * placeholder and for CI's real-SHA rewrite (whose heredoc carries this
 * same annotation, so the type stays `string` regardless of the actual
 * value stamped in). `readonly` keeps the as-const-style immutability
 * without the literal narrowing.
 */
export const BUILD: { readonly commit: string; readonly runId: string; readonly builtAt: string } =
  { commit: 'dev', runId: 'dev', builtAt: 'dev' };
