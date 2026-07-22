# API Reference

Routes exposed by the gitcert Worker. Updated whenever a route, field, or
request/response schema is added, changed, or removed (see
`rules/standards/documentation.md`).

M1 ships one route — the GitHub App webhook receiver. Public surfaces
(`/b/*`, `/api/*`, `/verify/*`, `/pubkey`, `/`, `/dashboard`, etc.) land in
later milestones per `SPEC.md` §12.

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
