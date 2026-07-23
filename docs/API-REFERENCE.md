# API Reference

Routes exposed by the gitcert Worker. Updated whenever a route, field, or
request/response schema is added, changed, or removed (see
`rules/standards/documentation.md`).

M1 shipped the GitHub App webhook receiver. M2 adds the public read
surfaces below — badge SVGs, signed JSON, the verify certificate, the
public key endpoint, and the health probe. `/`, `/dashboard`, and the
shadcn registry (`/r/*`) still land in later milestones per `SPEC.md` §12.

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

Badge SVG, e.g. `<img src="https://gitcert.harborstack.app/b/wnston/client-platform/commits.svg">`.

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
`https://gitcert.harborstack.app/api/wnston/client-platform.json`.

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
  suspended — one bucket, no existence oracle). `Cache-Control` identical
  to the 200 case above (`max-age=300, s-maxage=1800, stale-while-revalidate=86400`).
- Served through `caches.default`, keyed on the full request URL.

## `GET /verify/:owner/:repo`

Server-rendered HTML certificate for humans, e.g.
`https://gitcert.harborstack.app/verify/wnston/client-platform`. Linked from
badges' verified seal.

- **Auth:** none. Public, cacheable, CORS-open.
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
  `Cache-Control: public, max-age=300`.
- No `ETag`/conditional-GET support on this route. Served through
  `caches.default`, keyed on the full request URL.

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
