/**
 * Typed Cloudflare Worker bindings for gitcert.
 *
 * Every handler, lib function, and collector module receives `env: Env` —
 * never `any`. Secrets are read exclusively from here (never hardcoded, never
 * logged).
 */
export interface Env {
  /** D1 binding: installations, repos, stats (migrations/0001_init.sql). */
  DB: D1Database;
  /** GitHub App id — used as the `iss` claim when minting App JWTs. */
  GITHUB_APP_ID: string;
  /** GitHub App private key, PKCS#8 PEM — signs App JWTs (RS256). */
  GITHUB_APP_PRIVATE_KEY: string;
  /** Shared secret configured on the GitHub App's webhook (HMAC-SHA256). */
  GITHUB_WEBHOOK_SECRET: string;
  /** Ed25519 signing seed, base64 raw 32 bytes — signs attestation payloads. */
  SIGNING_KEY: string;
  /** GitHub App OAuth client id — public, used to build the `/auth/login` authorize URL. */
  GITHUB_CLIENT_ID: string;
  /** GitHub App OAuth client secret — exchanged for a one-time user token at `/auth/callback`, never stored. */
  GITHUB_CLIENT_SECRET: string;
  /** HMAC signing secret for the `gc_session` owner-session cookie (SPEC.md §M3 — stateless, no session store). */
  SESSION_SECRET: string;
}
