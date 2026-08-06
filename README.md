# gitcert

**GitCert** — verified badges for private GitHub repositories.

Live at **[gitcert.harborstack.app](https://gitcert.harborstack.app)**.

## What it is

Shields.io-style badges, but for numbers a public badge service can't see:
commits, issues, PRs, language mix, and more from repos you never make
public. GitCert installs as a **read-only** GitHub App, reads your real
stats straight from GitHub's API, signs them, and serves badges, a signed
JSON endpoint, and a human-readable verify certificate that anyone —
a recruiter, a client, a hiring manager — can independently check.

Think of it as a notary for your GitHub activity: GitCert doesn't vouch for
your code quality, only that the numbers it shows came from GitHub's API,
unmodified, via the collector code below.

## How it works

```
GitHub App installed ──► cron collector (GraphQL) ──► D1 ──► Ed25519-signed
                                                               payload
                                                                 │
                                          ┌──────────────────────┼──────────────────────┐
                                          ▼                      ▼                      ▼
                                    badge SVG            signed JSON              verify page
```

1. You install the GitCert GitHub App and pick which repositories to attest.
2. A cron job (every 15 minutes) fetches fresh stats per installation via
   GitHub's GraphQL API, using a short-lived (1-hour) installation token.
3. Each snapshot is canonicalized and signed with Ed25519, then stored in D1.
4. Badges, the signed JSON endpoint, and the verify page all read that
   stored, already-signed snapshot — **no badge or API request ever calls
   GitHub**. Freshness comes from the cron job, not from the request path.

```md
![commits](https://gitcert.harborstack.app/b/johndoe/client-platform/commits.svg)
```

```
https://gitcert.harborstack.app/api/johndoe/client-platform.json
https://gitcert.harborstack.app/verify/johndoe/client-platform
```

## Trust model

This repository is open source specifically so the trust model can be
checked, not taken on faith.

- **Permissions, enumerated honestly.** The GitHub App requests exactly
  four scopes, all read-only: `metadata: read` (baseline), `contents: read`
  (commit history and default branch — this is what makes commit counts
  possible), `issues: read` (open issue counts), `pull_requests: read`
  (open PR counts). The App never writes to a repository, and gitcert only
  ever stores aggregates (commit counts, timestamps, issue/PR totals,
  language shares) — never file contents, never diffs.
- **Signed, served verbatim.** Every snapshot's canonical payload is signed
  once at collection time with Ed25519 and stored as-is; every response is
  the stored bytes, byte-for-byte — never re-parsed, re-serialized, or
  recomputed on read. Verify any signed response against the public key at
  [`/pubkey`](https://gitcert.harborstack.app/pubkey):

  ```sh
  curl -s https://gitcert.harborstack.app/api/johndoe/client-platform.json
  curl -s https://gitcert.harborstack.app/pubkey
  ```

  Or just open a repo's [`/verify/:owner/:repo`](https://gitcert.harborstack.app/verify/johndoe/client-platform)
  page — its `[verify]` button runs the same Ed25519 check client-side, in
  the browser, via WebCrypto.

- **No existence oracle.** A repo you've never installed the App on, a repo
  you've explicitly excluded, one that's been removed from the
  installation, and one whose installation is suspended are all
  indistinguishable on every public surface — same `not found` badge, same
  status code. There's no way to probe gitcert to learn whether a private
  repo exists.
- **No long-lived credentials at rest.** Installation tokens are minted
  fresh per collector run and expire in an hour; nothing token-shaped is
  ever persisted. The one-time OAuth user token used to identify you for
  the dashboard is used for a single API call and discarded — never stored,
  never logged.
- **Read the collector.** The code that talks to GitHub's API lives in
  [`src/collector/`](src/collector) — open it and see exactly which
  GraphQL fields are requested and how a snapshot becomes a signature.

## Verifying this deployment

The repo is public, but until now nothing bound the audited source to the
running deployment — deploys came from a maintainer's laptop. As of this
feature, every push to `main` is what deploys: GitHub Actions checks out
that exact commit, runs lint/typecheck/tests, and only then ships it.

Check what commit is actually live:

```sh
curl -s https://gitcert.harborstack.app/version
```

```json
{
  "version": "0.6.4",
  "commit": "<full 40-char sha>",
  "commit_short": "<first 7 chars>",
  "run_id": "<github actions run id>",
  "built_at": "<UTC ISO 8601 build timestamp>",
  "source_url": "https://github.com/supergithubo/gitcert/commit/<sha>",
  "run_url": "https://github.com/supergithubo/gitcert/actions/runs/<run_id>"
}
```

Compare `commit` against this repo's head-of-`main`, then open `run_url` to
read the public build log for that exact deploy. The footer on every page
links the same way.

**This proves nothing cryptographically** — Cloudflare Workers has no remote
attestation, and the Worker is simply self-reporting its own commit SHA.
What it does do is close the accidental-drift gap (no more shipping a dirty
or untagged tree unnoticed) and narrow the deliberate one: a maintainer who
wants to deploy unpublished code now also has to publish a false SHA against
a public Actions log to hide it.

## Self-hosting

GitCert is one Cloudflare Worker, one D1 database, and a cron trigger — no
separate frontend, no Node server.

1. **Cloudflare account + Wrangler.**
   ```sh
   npm install
   npx wrangler login
   ```
2. **Create the GitHub App** (manifest-driven registration recommended):
   - Permissions (all read-only): `metadata: read`, `contents: read`,
     `issues: read`, `pull_requests: read`.
   - Webhook events: `installation`, `installation_repositories`,
     `repository`.
   - URLs (swap in your own domain): Homepage `https://<your-domain>`,
     Setup URL `https://<your-domain>/setup`, Callback URL
     `https://<your-domain>/auth/callback`, Webhook URL
     `https://<your-domain>/webhooks/github`.
   - Enable "Request user authorization during installation" — this is
     what identifies the installing owner for the dashboard session.
3. **Create the D1 database and apply migrations:**
   ```sh
   npx wrangler d1 create gitcert
   # paste the returned database_id into wrangler.toml
   npx wrangler d1 migrations apply DB --remote
   ```
4. **Set secrets and vars** (`wrangler secret put <NAME>` for secrets;
   plain values go in `wrangler.toml`'s `[vars]`):

   | Name                     | Kind   | Purpose                                                 |
   | ------------------------ | ------ | ------------------------------------------------------- |
   | `GITHUB_APP_ID`          | var    | `iss` claim when minting App JWTs                       |
   | `GITHUB_APP_PRIVATE_KEY` | secret | PKCS#8 PEM — signs App JWTs (RS256)                     |
   | `GITHUB_WEBHOOK_SECRET`  | secret | HMAC-SHA256 verification of webhook deliveries          |
   | `GITHUB_CLIENT_ID`       | var    | OAuth client id for the `/auth/login` authorize URL     |
   | `GITHUB_CLIENT_SECRET`   | secret | OAuth client secret, exchanged once at `/auth/callback` |
   | `SIGNING_KEY`            | secret | Ed25519 seed (base64, raw 32 bytes) — signs payloads    |
   | `SESSION_SECRET`         | secret | HMAC key for the stateless owner-session cookie         |

   A fork also inherits `.github/workflows/deploy.yml`, which deploys on
   every push to `main`. That needs its own **GitHub repo secrets**
   (Settings → Secrets and variables → Actions) — distinct from the Worker
   secrets above, which `wrangler secret put` sets instead:

   | Name                    | Kind               | Purpose                                                    |
   | ----------------------- | ------------------ | ---------------------------------------------------------- |
   | `CLOUDFLARE_API_TOKEN`  | GitHub repo secret | Scopes: _Workers Scripts: Edit_ + the zone for your route  |
   | `CLOUDFLARE_ACCOUNT_ID` | GitHub repo secret | Account the `cloudflare/wrangler-action` step deploys into |

   The workflow fails safely without them (a push just fails to deploy;
   production is untouched). Either way, replace `wrangler.toml`'s route/zone
   and D1 `database_id` with your own before the first deploy — those still
   point at the maintainer's.

5. **Cron trigger** — already declared in `wrangler.toml` (`*/15 * * * *`);
   adjust if you want a different collection cadence.
6. **Deploy:** push to `main` — `.github/workflows/deploy.yml` builds, tests,
   and deploys automatically once the two repo secrets above are set. For a
   one-off manual deploy instead (e.g. before wiring up the two secrets):
   ```sh
   npm run build:css
   npx wrangler deploy
   ```
7. **Local development** — copy `.dev.vars.example` to `.dev.vars` (gitignored)
   and fill in real values, then:
   ```sh
   npm run dev
   ```

## Development

| Command             | What                                                       |
| ------------------- | ---------------------------------------------------------- |
| `npm run dev`       | `wrangler dev` — local Worker, local D1 state, `.dev.vars` |
| `npm run typecheck` | `tsc --noEmit`                                             |
| `npm test`          | vitest (`@cloudflare/vitest-pool-workers`)                 |
| `npm run lint`      | prettier check                                             |
| `npm run check`     | typecheck + `wrangler deploy --dry-run`                    |
| `npm run build:css` | rebuilds `public/styles.css` from Tailwind sources         |

Stack: Cloudflare Workers · Hono (server-rendered JSX, zero client JS by
default) · D1 · TypeScript · Tailwind · hand-rolled SVG badges.

Contributions and audits welcome — the collector (`src/collector/`),
signing (`src/lib/sign.ts`), and query layer (`src/lib/db.ts`) are the
highest-value places to look if you want to verify the trust model
end-to-end.

## License

MIT — see [`LICENSE`](LICENSE).
