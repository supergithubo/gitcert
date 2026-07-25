# API Reference

Routes exposed by the gitcert Worker. Updated whenever a route, field, or
request/response schema is added, changed, or removed (see
`rules/standards/documentation.md`).

M1 shipped the GitHub App webhook receiver. M2 added the public read
surfaces — badge SVGs, signed JSON, the verify certificate, the public
key endpoint, and the health probe. M3 adds the owner surfaces below —
OAuth login/session, the dashboard, and the owner mutations
(`/repos/:id/settings`, `/repos/:id/refresh`). M4 adds the landing page
(`GET /`, below). A later cycle adds the public docs page (`GET /docs`)
and threads the signed-in `login` into a shared account menu across
`/`, `/docs`, and `/dashboard`; `POST /auth/logout` now redirects to
`/?signed_out=1` instead of rendering its own page. The shadcn registry
(`/r/*`) still lands in a later milestone per `SPEC.md` §12.

Every route below is a `GET`. No handler calls GitHub in the request
path — each is one D1 read (`selectPublicRepoState` / `selectOldestCollectedAt`)
plus a template render (architectures/edge-cache, architectures/attestation).
All of them send `Access-Control-Allow-Origin: *`, including on error
responses.

**No existence oracle:** on every route below, an unknown repo, an
excluded repo (`included = 0`), a removed repo (`removed_at` set), and a
repo whose owning installation is suspended (`suspended_at` set) are one
indistinguishable "hidden" bucket — same status code, same headers, same
response body, regardless of which of the four caused it.

## `GET /b/:owner/:repo/:metric.svg`

Badge SVG, e.g. `<img src="https://gitcert.harborstack.app/b/johndoe/client-platform/commits.svg">`.

- **Auth:** none. Public, cacheable, CORS-open.
- **Path params:**
  - `metric` — one of `commits`, `last-commit`, `issues` (rendered label
    "open issues"), `open-prs`, `language`, `created`, `first-commit`,
    `size`. Any other value is fail-soft (see `not found` state below),
    never a 404/500 image.
- **Query params:**
  - `style` — `flat` (default) or `pill`. Any other value falls back to `flat`.
  - `theme` — `light` (default), `dark`, or `auto` (embeds a
    `prefers-color-scheme` media query in the SVG). Any other value falls
    back to `light`.
  - `label` — overrides the rendered label text. XML-escaped and capped
    at 64 characters server-side.
- **Response:** always `200`, always `Content-Type: image/svg+xml` — a
  designed SVG for every state, never a broken image.

  | State       | Trigger                                                                                   | `Cache-Control`                                                    | `ETag`                                         |
  | ----------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------- |
  | normal      | visible repo, stats row, `collected_at` ≤ 24h                                             | `public, max-age=300, s-maxage=1800, stale-while-revalidate=86400` | `"cert_serial:metric:style:theme"` (see below) |
  | stale       | visible repo, stats row, `collected_at` > 24h — hollow seal, muted value                  | same as normal                                                     | same as normal                                 |
  | collecting… | visible repo, no stats row yet                                                            | `public, max-age=60`                                               | none                                           |
  | not found   | unknown metric slug, **or** hidden repo (unknown/excluded/removed/suspended — one bucket) | same as normal                                                     | none                                           |
  - **ETag:** a strong ETag, present only when a stats row exists (never on
    `collecting…`/`not found`): `"cert_serial:metric:style:theme"`, with
    `:sha256(label)[:8]` appended when a `label` override is present (the
    label changes rendered content, so the ETag must vary with it).
  - **Conditional GET:** a matching `If-None-Match` returns `304` with no
    body (only `ETag`/`Cache-Control`/CORS headers carried over).
  - Served through `caches.default`, keyed on the full request URL (owner,
    repo, metric, style, theme, label all live in the URL — no variant
    bleed).

## `GET /api/:owner/:repo.json`

Signed JSON attestation for one repo, e.g.
`https://gitcert.harborstack.app/api/johndoe/client-platform.json`.

- **Auth:** none. Public, cacheable, CORS-open.
- **200** (repo visible, stats row exists):
  - `Content-Type: application/json`
  - Body is assembled by **string concatenation around the stored
    `payload_json` bytes** — never `JSON.parse`d or re-serialized, so the
    stored signature keeps verifying:
    ```json
    {"payload":<stored payload_json, verbatim>,"signature":"<base64 ed25519>","public_key_url":"https://gitcert.harborstack.app/pubkey"}
    ```
  - `Cache-Control: public, max-age=300, s-maxage=1800, stale-while-revalidate=86400`
  - `ETag: "<cert_serial>"` (strong, quoted). A matching `If-None-Match`
    returns `304` with no body.
- **404 `{"error":"collecting"}`** — repo visible, no stats row yet.
  `Cache-Control: public, max-age=60`.
- **404 `{"error":"not_found"}`** — hidden repo (unknown/excluded/removed/
  suspended — one bucket, no existence oracle). `Cache-Control: public,
max-age=60` — same short TTL as the `collecting` case above (not the
  200 case's), so a settings toggle off→on is backstopped by a short
  client-side re-check even on a purge miss (fix: toggle-cache-purge).
- Served through `caches.default`, keyed on the full request URL. A
  settings toggle (either direction) or a manual refresh purges this
  cache entry directly — see `POST /repos/:id/settings` and
  `POST /repos/:id/refresh` under "Owner routes" below.

## `GET /verify/:owner/:repo`

Server-rendered HTML certificate for humans, e.g.
`https://gitcert.harborstack.app/verify/johndoe/client-platform`. Linked from
badges' verified seal.

- **Auth:** none required — session-_aware_, not session-_gated_ (spec
  overview §Step 6). No ownership check and no owner-scoped D1 join: a
  signed-in viewer of ANY repo (owned or not) is treated identically.
- **Cookie-less request** (the overwhelming majority — recruiters/clients)
  — byte-identical to the pre-session-aware route, in full:
  - **200** (repo visible, stats row exists) — `Content-Type: text/html; charset=UTF-8`,
    `Cache-Control: public, max-age=300`. Renders the GitCert header/seal,
    `# GC-XXXXXX` serial, repository + private/public, owner, all 8 stats
    rows, the attested timestamp, the signing method, the truncated
    signature (`ed25519 <first-4>…<last-4>`), and a `[verify]` button — the
    only client-side script in M2, which fetches `/api/:owner/:repo.json` +
    `/pubkey` and checks the Ed25519 signature via browser WebCrypto. There
    is no stale variant on the certificate: the honest attested timestamp
    already covers staleness.
  - **200 collecting** — repo visible, no stats row yet.
    `Cache-Control: public, max-age=60`. Renders a "collecting…" placeholder page.
  - **404 not found** — hidden repo (unknown/excluded/removed/suspended —
    one page and status for all four causes, no existence oracle).
    `Cache-Control: public, max-age=60` — same short TTL as the collecting
    case above (not the 200 case's `max-age=300`), so a settings toggle
    off→on is backstopped by a short client-side re-check even on a purge
    miss (fix: toggle-cache-purge).
  - No `ETag`/conditional-GET support on this route. Served through
    `caches.default`, keyed on the full request URL — the cookie check runs
    strictly before this lookup, so a personalized variant can never
    populate or be served from it. A settings toggle (either direction) or
    a manual refresh purges this cache entry directly — see
    `POST /repos/:id/settings` and `POST /repos/:id/refresh` under
    "Owner routes" below.
- **`gc_session` cookie present** — `caches.default` is never touched, valid
  session or not:
  - **Valid session** — same page/status/branching as above, plus a generic
    `← Back to dashboard` → `/dashboard` link (rendered once in the shared
    `CertFrame`, identical across all three states and — critically — across
    all four hidden causes, so it leaks nothing). `Cache-Control: no-store`
    overrides the per-state tier; never cached.
  - **Invalid/expired session** — renders the same cookie-less markup (no
    back-link) with `Cache-Control: no-store` and a `Set-Cookie` clearing
    `gc_session` (`Max-Age=0`), so the client falls back onto the cacheable
    cookie-less path next request.

## `GET /pubkey`

The Ed25519 public key used to verify every `/api/*.json` signature.

- **Auth:** none. Public, cacheable, CORS-open.
- **200**, `Content-Type: application/json`, derived from the `SIGNING_KEY`
  secret via WebCrypto at request time (no persistence, no GitHub call):
  ```json
  {
    "algorithm": "Ed25519",
    "public_key": "<raw 32-byte base64>",
    "jwk": { "kty": "OKP", "crv": "Ed25519", "x": "<base64url>" }
  }
  ```
- `Cache-Control: public, max-age=86400`. No `ETag`. Served through `caches.default`.

## `GET /healthz`

Operational probe — collector freshness, not a product surface.

- **Auth:** none.
- **200**, `Content-Type: application/json`:
  ```json
  {"status":"ok","max_lag_seconds":<integer|null>}
  ```
  `max_lag_seconds` is `now − MIN(collected_at)` across included,
  non-removed repos of non-suspended installations; `null` when no repo
  has been collected yet.
- `Cache-Control: no-store` — **deliberately not served through
  `caches.default`**. This is the one intentional exception to the "every
  public GET is cached" rule: the entire value of a health probe is
  freshness, so caching it would defeat its purpose.

## `POST /webhooks/github`

Machine-to-machine receiver for GitHub App webhook deliveries. Not intended
for direct client use.

- **Auth:** `X-Hub-Signature-256` HMAC-SHA256 over the raw request body,
  keyed by the `GITHUB_WEBHOOK_SECRET` secret. Verified before any body
  parsing. There is no other authentication — GitHub's signature is the
  trust boundary.
- **Request:** `Content-Type: application/json`. Body is GitHub's webhook
  payload for one of the following `X-Github-Event` values:
  - `installation` — actions `created`, `deleted`, `suspend`, `unsuspend`
    are handled; other actions are a no-op.
  - `installation_repositories` — actions `added`, `removed`.
  - `repository` — actions `renamed`, `transferred`, `privatized`,
    `publicized`.
  - Any other event type, or an unhandled action within a known event
    type, is a 200 no-op (GitHub retries on non-2xx responses).
- **Response:**
  - `200 { "ok": true }` — signature verified and the event was processed
    (or intentionally no-op'd).
  - `400 { "error": "malformed JSON body" }` — signature verified but the
    body did not parse as JSON.
  - `401` (empty body) — missing or invalid `X-Hub-Signature-256`. No
    detail is returned, and no database write occurs.
- **Side effects:** upserts `installations`/`repos` rows in D1 (idempotent);
  on `installation created`, also enqueues an immediate collector run for
  that installation via `executionCtx.waitUntil` (fire-and-forget — the
  response does not wait on it).

## `GET /`

The landing page (M4), e.g. `https://gitcert.harborstack.app/`. Mounted
last in the route assembly. Renders one of two variants depending on
whether the request carries a `gc_session` cookie — the cookie check
happens **before** any `caches.default` lookup, so the shared, URL-keyed
cache can only ever see cookie-less requests and can never leak a
personalized variant (architectures/edge-cache).

- **No `gc_session` cookie** — the signed-out variant (demo badges, an
  "Install App" CTA to `/auth/login`). `200`, `Content-Type: text/html;
charset=UTF-8`, `Cache-Control: public, max-age=300`,
  `Access-Control-Allow-Origin: *`. Served through `caches.default`, keyed
  on the full request URL, same as the other public GETs above — this is
  the only branch that ever touches the shared cache. Zero I/O beyond the
  cache lookup: a pure template render, no D1 read, no GitHub call.
  - `?signed_out=1` (set by `POST /auth/logout`'s redirect) renders a
    post-logout acknowledgment band above the hero, reassuring that
    signing out did not touch repo access. This query string is a cache
    key **distinct** from the base `/` — `edgeCache` keys on the full
    request URL, so the band is never a per-request mutation of the base
    cached page. Dismiss is a plain `<a href="/">`, no JS.
- **`gc_session` cookie present** — `caches.default` is never consulted or
  populated, regardless of whether the cookie verifies. Always
  `Cache-Control: no-store`, no CORS header (owner-surface parity with
  `/dashboard`):
  - **Valid session** — one D1 read (`countAttestedRepos`, scoped to the
    session's `github_id`) → the signed-in variant (a "Go to Dashboard"
    CTA to `/dashboard`, pluralized `N repos attested` microcopy, and the
    shared account menu fed by the session's `login`).
    The count is truthful: only repos that are `included = 1`, non-removed, on
    a live (non-suspended) installation, **and** already have a stored
    stats row count — a just-installed, not-yet-collected repo does not
    inflate the number.
  - **Invalid/expired session** — the signed-out variant is rendered
    (same markup as the cookie-less case), plus
    `Set-Cookie: gc_session=...; Max-Age=0` clearing the stale cookie so
    the client's next request falls back onto the cacheable cookie-less
    path. A forged or expired claim renders only public content — no
    error, no detail leaked.
- No GitHub call anywhere in this route.

## `GET /docs`

The public documentation page, e.g. `https://gitcert.harborstack.app/docs`.
Mirrors `GET /`'s cookie-first pattern verbatim — the cookie check runs
**before** any `caches.default` lookup, so only cookie-less requests ever
consult or populate the shared cache (architectures/edge-cache). The docs
body itself is identical in every branch; only the shared Nav's account
menu differs.

- **No `gc_session` cookie** — signed-out nav. `200`, `Content-Type:
text/html; charset=UTF-8`, `Cache-Control: public, max-age=300`,
  `Access-Control-Allow-Origin: *`. Served through `caches.default`, keyed
  on the full request URL. Zero I/O beyond the cache lookup.
- **`gc_session` cookie present** — `caches.default` is never consulted or
  populated, regardless of whether the cookie verifies. Always
  `Cache-Control: no-store`, no CORS header:
  - **Valid session** — the account menu renders, fed by the session's
    `login`. No D1 read.
  - **Invalid/expired session** — signed-out nav rendered, plus
    `Set-Cookie: gc_session=...; Max-Age=0` clearing the stale cookie.
- No GitHub call, no D1 read anywhere in this route.

## Owner routes (M3)

Session-authenticated surfaces for the repo owner: sign-in, the
dashboard, and the two owner mutations. Every route below always sends
`Cache-Control: no-store`, is never served through `caches.default`
(`edgeCache`), and sends no CORS header — the opposite policy from the
public surfaces above. JSON errors use a consistent `{ "error": "<code>" }`
shape.

**Tenancy:** the tenant is the GitHub App installation; ownership maps
session → the numeric GitHub user id → the installations the
`installation_users` link table says that user administers → their live
(non-suspended) repos (org-installations spec). `installations.account_id`
alone is no longer the ownership key — it only ever matched a personal
(`User`) installation, since an organization installation's `account_id`
is the org's own GitHub id, never a member's. `installation_users` is
populated from `GET /user/installations` at `/auth/callback` (below); a
user administers an installation if GitHub reports them as having access
to it (MVP: no admin-vs-member role gating). Every owner query/mutation is
scoped through this join. **Unknown, not-owned, and removed resources are
always a `404`, never a `403`** — a `403` would let an authenticated
caller enumerate which repo ids are registered in gitcert, an existence
oracle for private repos (CRITICAL invariant).

**Session cookie** (`gc_session`): `base64url(payloadJson) + "." +
base64url(HMAC-SHA256(SESSION_SECRET, base64url(payloadJson)))`, payload
`{ "github_id": number, "login": string, "exp": number }` (unix seconds,
issued for 7 days). Attributes: `HttpOnly; Secure; SameSite=Lax; Path=/;
Max-Age=604800`. Verification is structural parse → timing-safe MAC
compare → `exp` check; any failure (tampered payload, wrong MAC, expired)
is treated as a plain signed-out request — never a 500, never a detail
leaked. Sessions are stateless: there is no server-side session store or
revocation list, so signing out is just clearing the cookie.

### `GET /auth/login`

Starts the GitHub App OAuth user flow (identity only — no scopes,
no stored token).

- Generates a 32-byte random state nonce (base64url) and sets it as
  `gc_oauth_state` (`HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`).
- `302` to `https://github.com/login/oauth/authorize?client_id=<GITHUB_CLIENT_ID>&state=<nonce>`.
  No `scope` param (identity only), no `redirect_uri` (GitHub uses the
  App's registered callback).

### `GET /auth/callback`

- **(1)** GitHub's `error` param present → `400` error page (see below).
- **(2)** `state` query param must timing-safe-match the `gc_oauth_state`
  cookie → missing/mismatch is a `400` error page with the state cookie
  cleared. **Bypass, install-initiated shape only:** this check is skipped
  ONLY when the `state` query param is absent AND the `gc_oauth_state`
  cookie is absent AND `installation_id` parses to a valid installation id
  AND `setup_action` is present — GitHub's "Request user authorization
  during installation" redirect starts the OAuth dance itself, so the
  browser never receives a `gc_oauth_state` cookie and GitHub never sends
  a `state` param. If either a `state` param or a `gc_oauth_state` cookie
  is present, the mandatory timing-safe match still applies in full —
  a mismatched or unpaired value is a `400` even when `installation_id` /
  `setup_action` are present; install params never bypass a check that
  actually runs. Security note: this leaves the standard, accepted
  login-CSRF residual for GitHub App install flows — an attacker-crafted
  callback can at worst sign the victim into the attacker's own identity,
  never grant access to the victim's data, because the post-install
  collect kick in **(6)** stays gated by the D1 ownership check against
  the identity actually exchanged for this request, not by anything the
  attacker controls.
- **(3)** Exchanges `code` at `https://github.com/login/oauth/access_token`
  (`POST`, `Accept: application/json`) → failure is a `400` error page.
- **(4)** `GET https://api.github.com/user` with the exchanged token →
  `{ id, login }` → failure is a `400` error page.
- **(5)** `GET https://api.github.com/user/installations?per_page=100`
  with the same exchanged token (org-installations spec) — parses
  `{ installations: [{ id, … }] }`, keeping only numeric ids. A `2xx`
  response reconciles `installation_users` for this `github_id`: deletes
  every existing link for the user, then inserts one row per id returned
  (`replaceInstallationLinks`) — an empty array is a legal "administers
  nothing" (revocation). **Fail-open, mandatory:** any non-2xx response or
  a body that doesn't parse to that shape skips the reconcile entirely and
  keeps the user's existing links untouched; sign-in still succeeds. A
  transient GitHub error must never de-authorize a user or blank their
  dashboard. No pagination beyond the single `per_page=100` page (MVP,
  YAGNI). **The token now serves exactly these two requests (identity,
  then installation discovery) inside this one handler and is discarded
  after — never stored, never logged, never placed in the session, never
  written to D1** (attestation invariant, CRITICAL).
- **(6)** Sets the `gc_session` cookie for `{ github_id: id, login }`,
  clears `gc_oauth_state`.
- **(7)** If `installation_id` + `setup_action` query params are present
  (GitHub's "Request user authorization on install" redirect shape):
  D1-verifies `installation_id` is administered by this session (via the
  links just reconciled in **(5)**) and live, and — only if its repos'
  stats are missing or older than 5 minutes — kicks a targeted
  `runCollector({ installationId })` via `waitUntil`. An
  unowned/unknown/suspended `installation_id` (including the race where a
  webhook's insert hasn't landed yet) is a silent no-op — `installation_id`
  is never trusted for anything beyond this D1-verified lookup.
- **(8)** `302` to `/dashboard`.
- Every failure branch above (steps 1–4): `400`, a generic error page (no
  internals leaked), `gc_oauth_state` cleared, `Cache-Control: no-store`.
  Step 5 never fails the request — it only ever skips its own reconcile.

### `POST /auth/logout`

- No session required (idempotent). Clears `gc_session` (`Max-Age=0`).
- `302` to `/?signed_out=1` (the signed-out landing page's acknowledgment
  band — see `GET /`), `Cache-Control: no-store`. The dedicated
  `SignedOutPage` surface is retired; the signed-out landing is now the
  only signed-out surface. Reachable from the shared account menu's
  "Sign out" form.

### `GET /dashboard`

- **No/invalid/expired session:** clears `gc_session`, `302` to
  `/auth/login`.
- **Valid session:** one D1 read (`selectOwnedRepos`, scoped to the
  session's `github_id` via the `installation_users` join) → the
  dashboard page. `200`, HTML. Every installation the session administers
  (personal account, plus any linked organizations) that is live yields a
  group — **grouped by installation account, personal first, then orgs
  alphabetical** (org-installations spec); an installation with zero live
  repos still yields a group (empty repo list). Within a group, repos are
  non-removed and sorted `(owner, name)`; excluded (`included = 0`) repos
  are still listed (greyed, still selectable — re-enabling is only
  possible if they stay visible). `lastSyncAt` is the max `collected_at`
  across every repo across every group (`null` if nothing has been
  collected yet). **No GitHub call in this path** (edge-cache/attestation
  invariant — dashboard reads are D1-only).

### `GET /setup`

The GitHub App's Setup URL — receives direct/update install arrivals
(as opposed to `/auth/callback`, which receives the post-install redirect
when "Request user authorization on install" is enabled; both converge on
the same D1-verified kick logic).

- **No session:** `302` to `/auth/login`.
- **With session:** if an `installation_id` query param is present, same
  D1-verified ownership + freshness check and conditional collector kick
  as `/auth/callback` step (7) above. `302` to `/dashboard`. **Never
  errors user-visibly** — an unowned/unknown/suspended `installation_id`
  just skips the kick silently.

### `POST /repos/:id/settings`

Toggles whether a repo is publicly exposed (`included`).

- **Auth:** session required — `401 { "error": "unauthorized" }` without one.
- **Request:** `Content-Type: application/json`, body must be exactly
  `{ "included": boolean }`.
  - Malformed JSON → `400 { "error": "malformed_json" }`.
  - Valid JSON but wrong shape (extra fields, missing field, non-boolean
    `included`) → `422 { "error": "invalid_body" }`.
- **Mutation:** a single tenant-scoped `UPDATE` — `included` is only ever
  set when `:id` resolves to a non-removed repo whose installation is
  owned by the session and not suspended. Zero rows changed (unknown,
  not-owned, or removed — one indistinguishable bucket) →
  `404 { "error": "not_found" }`.
- **Success:** `200 { "ok": true, "included": <bool> }`. After responding,
  best-effort purges every cached public URL for the repo via `waitUntil`
  — the badge cache entries (8 metrics × {flat,pill} × {light,dark,auto},
  plus the bare-default URL per metric), **plus** the `/verify/:owner/:repo`
  and `/api/:owner/:repo.json` cache entries — so the dashboard's live
  preview, the verify page, and the API response all reflect the change
  immediately instead of waiting out their respective TTLs. Applies on
  both toggle directions (fix: toggle-cache-purge — an off→on toggle
  previously left a stale cached `not found` verify/api response for up
  to 5 minutes, since only badge URLs were purged).

### `POST /repos/:id/refresh`

Triggers an on-demand collector run for the repo's whole installation
(collection granularity is per-installation, not per-repo — one token
mint covers every repo GitHub returned for that installation).

- **Auth:** session required — `401 { "error": "unauthorized" }` without one.
- **Ownership:** `:id` resolved through the same owned/live join as
  `/repos/:id/settings`. Not owned/unknown/removed/suspended-installation
  → `404 { "error": "not_found" }` — never a `403`, and no GitHub call is
  made on this path.
- **Rate limit:** if the target repo's `stats.collected_at` is within 5
  minutes → `429 { "error": "rate_limited" }`, no GitHub call.
- **Success:** `202 { "ok": true }` immediately; `waitUntil`s
  `runCollector({ installationId })` followed by the same full public-URL
  cache purge (badge + verify + api) as the settings route. `202`/`429`
  intentionally extend the standard REST status table — the semantically
  correct codes for "accepted, work continues asynchronously" and "rate
  limited".
