import type { LanguageShare, PublicStats } from './types';

/**
 * All SQL for gitcert lives here as typed functions with bound parameters
 * (rules/library/stacks/d1/rules.md). Writes are idempotent upserts;
 * related writes are batched with `db.batch()` — D1 has no multi-statement
 * transactions, so a partial cron or webhook failure must converge on retry.
 * Soft-state columns (`suspended_at`, `removed_at`) are used instead of row
 * deletion for anything referenced by history or serials.
 */

export interface InstallationInput {
  id: number;
  accountLogin: string;
  accountId: number;
  accountType: string;
}

export interface RepoInput {
  id: number;
  owner: string;
  name: string;
  private: boolean;
}

export interface RepoUpdateInput {
  owner?: string;
  name?: string;
  private?: boolean;
}

export interface RepoForCollection {
  id: number;
  owner: string;
  name: string;
  private: boolean;
  /** Previously stored commit count, or null if this repo has never been collected. */
  previousCommits: number | null;
  /** Previously stored first-commit date, or null if not yet known. */
  previousFirstCommitAt: string | null;
}

export interface StatsInput {
  repoId: number;
  collectedAt: string;
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
  payloadJson: string;
  signature: string;
  certSerial: string;
}

/** Inserts a new installation, or reactivates (clears `suspended_at` on) an existing one. Idempotent. */
export async function upsertInstallation(db: D1Database, input: InstallationInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO installations (id, account_login, account_id, account_type, suspended_at)
       VALUES (?1, ?2, ?3, ?4, NULL)
       ON CONFLICT(id) DO UPDATE SET
         account_login = excluded.account_login,
         account_id = excluded.account_id,
         account_type = excluded.account_type,
         suspended_at = NULL`,
    )
    .bind(input.id, input.accountLogin, input.accountId, input.accountType)
    .run();
}

/** Sets `suspended_at` on installation deletion/suspend (soft state — never deletes the row). */
export async function suspendInstallation(
  db: D1Database,
  installationId: number,
  suspendedAt: string,
): Promise<void> {
  await db
    .prepare(`UPDATE installations SET suspended_at = ?2 WHERE id = ?1`)
    .bind(installationId, suspendedAt)
    .run();
}

/** Clears `suspended_at` on installation unsuspend. */
export async function unsuspendInstallation(db: D1Database, installationId: number): Promise<void> {
  await db
    .prepare(`UPDATE installations SET suspended_at = NULL WHERE id = ?1`)
    .bind(installationId)
    .run();
}

/**
 * Batched, idempotent upsert of an installation's repos (keyed by GitHub's
 * stable repo id). Reactivates a repo (`removed_at = NULL`) if it is added
 * back after having been removed.
 */
export async function upsertRepos(
  db: D1Database,
  installationId: number,
  repos: RepoInput[],
): Promise<void> {
  if (repos.length === 0) return;
  const statement = db.prepare(
    `INSERT INTO repos (id, installation_id, owner, name, private, included, removed_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 1, NULL)
     ON CONFLICT(id) DO UPDATE SET
       installation_id = excluded.installation_id,
       owner = excluded.owner,
       name = excluded.name,
       private = excluded.private,
       removed_at = NULL`,
  );
  await db.batch(
    repos.map((repo) =>
      statement.bind(repo.id, installationId, repo.owner, repo.name, repo.private ? 1 : 0),
    ),
  );
}

/** Sets `removed_at` when a repo leaves the installation (soft state — never deletes the row). */
export async function markRepoRemoved(
  db: D1Database,
  repoId: number,
  removedAt: string,
): Promise<void> {
  await db.prepare(`UPDATE repos SET removed_at = ?2 WHERE id = ?1`).bind(repoId, removedAt).run();
}

/** Applies a rename / visibility change / transfer to an existing repo (keyed by GitHub's stable repo id). */
export async function updateRepo(
  db: D1Database,
  repoId: number,
  update: RepoUpdateInput,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 2;
  if (update.owner !== undefined) {
    sets.push(`owner = ?${paramIndex}`);
    values.push(update.owner);
    paramIndex += 1;
  }
  if (update.name !== undefined) {
    sets.push(`name = ?${paramIndex}`);
    values.push(update.name);
    paramIndex += 1;
  }
  if (update.private !== undefined) {
    sets.push(`private = ?${paramIndex}`);
    values.push(update.private ? 1 : 0);
    paramIndex += 1;
  }
  if (sets.length === 0) return;
  await db
    .prepare(`UPDATE repos SET ${sets.join(', ')} WHERE id = ?1`)
    .bind(repoId, ...values)
    .run();
}

/**
 * Ids of installations that need a collector pass: not suspended, with at
 * least one included, non-removed repo whose stats are missing or older
 * than `cutoffIso`. The caller computes `cutoffIso` (now - 60min) so this
 * function stays a pure query with no wall-clock dependency.
 *
 * Ordered oldest-stats-first (never-collected repos sort first, via
 * `COALESCE(s.collected_at, '')` — an empty string sorts before any ISO
 * date string) and bounded to `LIMIT 15` per run (spec overview Decision
 * 8): ≤3 GitHub fetches per installation keeps a run inside the free-plan
 * 50-subrequest budget, while the every-15-minute cron throughput still
 * clears the 60-min staleness window across ≥60 installations/hour.
 */
export async function selectStaleInstallations(
  db: D1Database,
  cutoffIso: string,
): Promise<number[]> {
  const result = await db
    .prepare(
      `SELECT i.id AS id, MIN(COALESCE(s.collected_at, '')) AS oldest
       FROM installations i
       JOIN repos r ON r.installation_id = i.id
       LEFT JOIN stats s ON s.repo_id = r.id
       WHERE i.suspended_at IS NULL
         AND r.removed_at IS NULL
         AND r.included = 1
       GROUP BY i.id
       HAVING oldest = '' OR oldest < ?1
       ORDER BY oldest ASC
       LIMIT 15`,
    )
    .bind(cutoffIso)
    .all<{ id: number; oldest: string }>();
  return result.results.map((row) => row.id);
}

/** An installation's liveness fields — the collector's guard before minting a token. */
export interface InstallationLiveness {
  id: number;
  suspendedAt: string | null;
}

/** Loads one installation's id + `suspended_at`, or `null` if the installation is unknown. */
export async function selectInstallation(
  db: D1Database,
  installationId: number,
): Promise<InstallationLiveness | null> {
  const row = await db
    .prepare(`SELECT id, suspended_at FROM installations WHERE id = ?1`)
    .bind(installationId)
    .first<{ id: number; suspended_at: string | null }>();
  if (!row) return null;
  return { id: row.id, suspendedAt: row.suspended_at };
}

/** Latest `collected_at` across an owned installation's active repos — `null` when never collected. */
export interface OwnedInstallationFreshness {
  latestCollectedAt: string | null;
}

/**
 * Decision 9's D1-verified ownership lookup (spec overview): `installationId`
 * is only ever trusted as far as this scoped query says — `null` when the
 * installation is unknown, `githubUserId` does not administer it (no
 * `installation_users` link — org-installations spec), or it is suspended,
 * byte-identical whichever cause. Callers (post-install kick) use the
 * returned freshness to decide whether a collect is warranted; they never
 * see which of the three caused a `null`.
 */
export async function selectOwnedInstallationFreshness(
  db: D1Database,
  installationId: number,
  githubUserId: number,
): Promise<OwnedInstallationFreshness | null> {
  const installation = await db
    .prepare(
      `SELECT i.id AS id
       FROM installations i
       JOIN installation_users iu ON iu.installation_id = i.id
       WHERE i.id = ?1 AND iu.github_user_id = ?2 AND i.suspended_at IS NULL`,
    )
    .bind(installationId, githubUserId)
    .first<{ id: number }>();
  if (!installation) return null;

  const row = await db
    .prepare(
      `SELECT MAX(s.collected_at) AS latest
       FROM repos r
       LEFT JOIN stats s ON s.repo_id = r.id
       WHERE r.installation_id = ?1 AND r.removed_at IS NULL`,
    )
    .bind(installationId)
    .first<{ latest: string | null }>();
  return { latestCollectedAt: row?.latest ?? null };
}

/** `installations.account_type` — the two shapes a GitHub App installation can have. */
export type AccountType = 'User' | 'Organization';

/** One dashboard-tenant repo within an `OwnedAccount` group (Frozen Interface `DashboardRepo`, spec overview). */
export interface OwnedRepo {
  id: number;
  owner: string;
  name: string;
  private: boolean;
  included: boolean;
  /** `stats.collected_at` (ISO) — `null` means no stats row yet (collecting). */
  collectedAt: string | null;
}

/** One installation the session tenant administers, with its live repos (Frozen Interface `DashboardAccount`, spec overview). */
export interface OwnedAccount {
  installationId: number;
  accountLogin: string;
  accountType: AccountType;
  repos: OwnedRepo[];
}

/** `GET /dashboard`'s full read (Frozen Interface `DashboardPageProps`, minus `login`). */
export interface OwnedReposResult {
  accounts: OwnedAccount[];
}

interface OwnedRepoRow {
  installation_id: number;
  account_login: string;
  account_type: string;
  id: number | null;
  owner: string | null;
  name: string | null;
  private: number | null;
  included: number | null;
  collected_at: string | null;
}

/**
 * Groups the flat `selectOwnedRepos` row set into per-installation account
 * groups, in first-seen order (the SQL `ORDER BY` already puts the tenant's
 * personal account first, then orgs alphabetically — this function never
 * re-sorts). A `LEFT JOIN repos` row with no repo (`id IS NULL`) contributes
 * an account group with an empty `repos` array (Decision D2 — an
 * installation with zero live repos still renders). Module-private and
 * pure so it is unit-testable without D1.
 */
function groupOwnedRepoRows(rows: OwnedRepoRow[]): OwnedAccount[] {
  const accounts: OwnedAccount[] = [];
  const byInstallation = new Map<number, OwnedAccount>();

  for (const row of rows) {
    let account = byInstallation.get(row.installation_id);
    if (!account) {
      account = {
        installationId: row.installation_id,
        accountLogin: row.account_login,
        accountType: row.account_type as AccountType,
        repos: [],
      };
      byInstallation.set(row.installation_id, account);
      accounts.push(account);
    }
    if (row.id === null || row.owner === null || row.name === null) continue;
    account.repos.push({
      id: row.id,
      owner: row.owner,
      name: row.name,
      private: row.private === 1,
      included: row.included === 1,
      collectedAt: row.collected_at,
    });
  }

  return accounts;
}

/**
 * The session tenant's full dashboard read (spec overview §Route
 * contracts — `GET /dashboard` calls exactly this one function): every
 * installation `githubUserId` administers (via `installation_users`) that
 * is live (non-suspended), each with its non-removed repos, grouped by
 * account. `LEFT JOIN repos`/`stats` so an installation with zero live
 * repos still yields a group (Decision D2). Ordering puts the tenant's own
 * personal account first, then orgs alphabetically, repos `(owner, name)`
 * within each group — a static literal `ORDER BY` expression, not
 * input-derived, exact because a user only ever administers their own
 * `User` installation. Excluded (`included = 0`) rows are still listed —
 * Decision 7 keeps them selectable in the builder, only greyed in the UI.
 * One query, not a per-account fan-out.
 */
export async function selectOwnedRepos(
  db: D1Database,
  githubUserId: number,
): Promise<OwnedReposResult> {
  const result = await db
    .prepare(
      `SELECT i.id AS installation_id, i.account_login AS account_login, i.account_type AS account_type,
              r.id AS id, r.owner AS owner, r.name AS name,
              r.private AS private, r.included AS included, s.collected_at AS collected_at
       FROM installations i
       JOIN installation_users iu ON iu.installation_id = i.id
       LEFT JOIN repos r ON r.installation_id = i.id AND r.removed_at IS NULL
       LEFT JOIN stats s ON s.repo_id = r.id
       WHERE iu.github_user_id = ?1 AND i.suspended_at IS NULL
       ORDER BY (i.account_type = 'User') DESC, i.account_login ASC, r.owner ASC, r.name ASC`,
    )
    .bind(githubUserId)
    .all<OwnedRepoRow>();

  return { accounts: groupOwnedRepoRows(result.results) };
}

/**
 * Full reconcile of the installations `githubUserId` administers (spec
 * overview §Step 2, org-installations): deletes every existing link for
 * this user, then inserts one row per id in `installationIds`. An empty
 * array is legal and means "administers nothing" (revocation — e.g. a
 * user removed from every org between sign-ins). Batched as a single
 * `db.batch()` call (D1 batches are transactional) so the reconcile never
 * leaves a torn state. Bound parameters only.
 */
export async function replaceInstallationLinks(
  db: D1Database,
  githubUserId: number,
  installationIds: number[],
): Promise<void> {
  const statements = [
    db.prepare(`DELETE FROM installation_users WHERE github_user_id = ?1`).bind(githubUserId),
    ...installationIds.map((installationId) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO installation_users (installation_id, github_user_id) VALUES (?1, ?2)`,
        )
        .bind(installationId, githubUserId),
    ),
  ];
  await db.batch(statements);
}

/** One repo, scoped to a tenant, with the fields `POST /repos/:id/refresh` needs. */
export interface OwnedRepoDetail {
  id: number;
  owner: string;
  name: string;
  installationId: number;
  collectedAt: string | null;
}

/**
 * One repo scoped to the installations `githubUserId` administers (via
 * `installation_users`), restricted to live (non-suspended) installations
 * — `null` when unknown, not owned, removed, or the owning installation is
 * suspended (one bucket, byte-identical). Backs `POST /repos/:id/refresh`'s
 * ownership check, which turns any `null` here into a uniform `404` —
 * never a `403` that would let an authenticated prober enumerate
 * registered repo ids (Decision 4, CRITICAL).
 */
export async function selectOwnedRepo(
  db: D1Database,
  repoId: number,
  githubUserId: number,
): Promise<OwnedRepoDetail | null> {
  const row = await db
    .prepare(
      `SELECT r.id AS id, r.owner AS owner, r.name AS name,
              r.installation_id AS installation_id, s.collected_at AS collected_at
       FROM repos r
       JOIN installations i ON i.id = r.installation_id
       JOIN installation_users iu ON iu.installation_id = i.id
       LEFT JOIN stats s ON s.repo_id = r.id
       WHERE r.id = ?1 AND iu.github_user_id = ?2
         AND i.suspended_at IS NULL AND r.removed_at IS NULL`,
    )
    .bind(repoId, githubUserId)
    .first<{
      id: number;
      owner: string;
      name: string;
      installation_id: number;
      collected_at: string | null;
    }>();
  if (!row) return null;
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    installationId: row.installation_id,
    collectedAt: row.collected_at,
  };
}

/**
 * `POST /repos/:id/settings`'s single tenant-scoped mutation (spec
 * overview §Route contracts — the exact statement shape is pinned by
 * review). Returns the D1 `changes` count so the caller can turn `0` into
 * a uniform `404` (Decision 4): unknown, not-owned, and removed are one
 * indistinguishable bucket to the caller.
 */
export async function updateRepoIncluded(
  db: D1Database,
  repoId: number,
  included: boolean,
  githubUserId: number,
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE repos SET included = ?1
       WHERE id = ?2 AND removed_at IS NULL
         AND installation_id IN (
           SELECT i.id FROM installations i
           JOIN installation_users iu ON iu.installation_id = i.id
           WHERE iu.github_user_id = ?3 AND i.suspended_at IS NULL
         )`,
    )
    .bind(included ? 1 : 0, repoId, githubUserId)
    .run();
  return result.meta.changes ?? 0;
}

/**
 * Truthful count of the session tenant's attested repos (M4 spec overview
 * §Step 2, backs `GET /`'s signed-in CTA microcopy): repos that are
 * `included = 1`, non-removed, on a live (non-suspended) installation
 * `githubUserId` administers (via `installation_users` — org-installations
 * spec), AND have a stored `stats` row (an `INNER JOIN`, not a `LEFT JOIN`
 * — a just-installed, not-yet-collected repo does not count as
 * "attested"). `0` for an unlinked/unknown account, same as any tenant
 * with nothing collected.
 */
export async function countAttestedRepos(db: D1Database, githubUserId: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM repos r
       JOIN installations i ON i.id = r.installation_id
       JOIN installation_users iu ON iu.installation_id = i.id
       JOIN stats s ON s.repo_id = r.id
       WHERE iu.github_user_id = ?1 AND i.suspended_at IS NULL
         AND r.removed_at IS NULL AND r.included = 1`,
    )
    .bind(githubUserId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/**
 * All active (non-removed) repos for an installation, joined with their
 * latest stored stats (commits, first_commit_at) so the collector can
 * decide whether a first-commit refetch is needed without a second query.
 * With `repoId`, narrows to that single repo (per-repo manual refresh) —
 * still scoped to the installation, so a repo id from another tenant returns
 * nothing.
 */
export async function selectReposForInstallation(
  db: D1Database,
  installationId: number,
  repoId?: number,
): Promise<RepoForCollection[]> {
  const result = await db
    .prepare(
      `SELECT r.id AS id, r.owner AS owner, r.name AS name, r.private AS private,
              s.commits AS previous_commits, s.first_commit_at AS previous_first_commit_at
       FROM repos r
       LEFT JOIN stats s ON s.repo_id = r.id
       WHERE r.installation_id = ?1 AND r.removed_at IS NULL
         AND (?2 IS NULL OR r.id = ?2)`,
    )
    .bind(installationId, repoId ?? null)
    .all<{
      id: number;
      owner: string;
      name: string;
      private: number;
      previous_commits: number | null;
      previous_first_commit_at: string | null;
    }>();
  return result.results.map((row) => ({
    id: row.id,
    owner: row.owner,
    name: row.name,
    private: row.private === 1,
    previousCommits: row.previous_commits,
    previousFirstCommitAt: row.previous_first_commit_at,
  }));
}

/** Idempotent upsert of a repo's latest stats snapshot. `payload_json` is stored verbatim — never parsed or re-serialized. */
export async function upsertStats(db: D1Database, input: StatsInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO stats (
         repo_id, collected_at, commits, last_commit_at, open_issues, open_prs,
         repo_created_at, first_commit_at, size_kb, primary_language, language_pct,
         languages_json, payload_json, signature, cert_serial
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
       ON CONFLICT(repo_id) DO UPDATE SET
         collected_at = excluded.collected_at,
         commits = excluded.commits,
         last_commit_at = excluded.last_commit_at,
         open_issues = excluded.open_issues,
         open_prs = excluded.open_prs,
         repo_created_at = excluded.repo_created_at,
         first_commit_at = excluded.first_commit_at,
         size_kb = excluded.size_kb,
         primary_language = excluded.primary_language,
         language_pct = excluded.language_pct,
         languages_json = excluded.languages_json,
         payload_json = excluded.payload_json,
         signature = excluded.signature,
         cert_serial = excluded.cert_serial`,
    )
    .bind(
      input.repoId,
      input.collectedAt,
      input.commits,
      input.lastCommitAt,
      input.openIssues,
      input.openPrs,
      input.repoCreatedAt,
      input.firstCommitAt,
      input.sizeKb,
      input.primaryLanguage,
      input.languagePct,
      JSON.stringify(input.languages),
      input.payloadJson,
      input.signature,
      input.certSerial,
    )
    .run();
}

/** Identity fields a public surface (badge/API/verify) is allowed to render. */
export interface PublicRepoRef {
  owner: string;
  name: string;
  private: boolean;
}

/**
 * Unknown repo, excluded (`included = 0`), removed, or the owning
 * installation is suspended — one bucket by design (no existence oracle,
 * architectures/multi-tenant + architectures/attestation).
 */
export interface PublicHiddenState {
  visibility: 'hidden';
}

/** Repo is public and live, but no stats row exists yet. */
export interface PublicCollectingState {
  visibility: 'collecting';
  repo: PublicRepoRef;
}

/** Repo is public, live, and has a stored signed snapshot. */
export interface PublicReadyState {
  visibility: 'ready';
  repo: PublicRepoRef;
  stats: PublicStats;
  payloadJson: string;
  signature: string;
  certSerial: string;
  collectedAt: string;
}

export type PublicRepoState = PublicHiddenState | PublicCollectingState | PublicReadyState;

interface PublicRepoStateRow {
  owner: string;
  name: string;
  private: number;
  included: number;
  removed_at: string | null;
  suspended_at: string | null;
  collected_at: string | null;
  commits: number | null;
  last_commit_at: string | null;
  open_issues: number | null;
  open_prs: number | null;
  repo_created_at: string | null;
  first_commit_at: string | null;
  size_kb: number | null;
  primary_language: string | null;
  language_pct: number | null;
  languages_json: string | null;
  payload_json: string | null;
  signature: string | null;
  cert_serial: string | null;
}

/**
 * The single read every public surface handler makes (badge/api/verify):
 * one `SELECT` joining `repos` → `installations` → `stats`, keyed by
 * `(owner, name)`. Collapses unknown / excluded / removed / suspended into
 * one `hidden` bucket so callers cannot distinguish the cause (no existence
 * oracle) — see architectures/attestation and architectures/multi-tenant.
 */
export async function selectPublicRepoState(
  db: D1Database,
  owner: string,
  name: string,
): Promise<PublicRepoState> {
  const row = await db
    .prepare(
      `SELECT r.owner AS owner, r.name AS name, r.private AS private,
              r.included AS included, r.removed_at AS removed_at,
              i.suspended_at AS suspended_at,
              s.collected_at AS collected_at, s.commits AS commits,
              s.last_commit_at AS last_commit_at, s.open_issues AS open_issues,
              s.open_prs AS open_prs, s.repo_created_at AS repo_created_at,
              s.first_commit_at AS first_commit_at, s.size_kb AS size_kb,
              s.primary_language AS primary_language, s.language_pct AS language_pct,
              s.languages_json AS languages_json, s.payload_json AS payload_json,
              s.signature AS signature, s.cert_serial AS cert_serial
       FROM repos r
       JOIN installations i ON i.id = r.installation_id
       LEFT JOIN stats s ON s.repo_id = r.id
       WHERE r.owner = ?1 AND r.name = ?2`,
    )
    .bind(owner, name)
    .first<PublicRepoStateRow>();

  if (!row || row.included !== 1 || row.removed_at !== null || row.suspended_at !== null) {
    return { visibility: 'hidden' };
  }

  const repo: PublicRepoRef = { owner: row.owner, name: row.name, private: row.private === 1 };

  if (
    row.collected_at === null ||
    row.payload_json === null ||
    row.signature === null ||
    row.cert_serial === null
  ) {
    return { visibility: 'collecting', repo };
  }

  const languages: LanguageShare[] = row.languages_json ? JSON.parse(row.languages_json) : [];
  const stats: PublicStats = {
    commits: row.commits ?? 0,
    lastCommitAt: row.last_commit_at,
    openIssues: row.open_issues ?? 0,
    openPrs: row.open_prs ?? 0,
    repoCreatedAt: row.repo_created_at,
    firstCommitAt: row.first_commit_at,
    sizeKb: row.size_kb,
    primaryLanguage: row.primary_language,
    languagePct: row.language_pct,
    languages,
  };

  return {
    visibility: 'ready',
    repo,
    stats,
    payloadJson: row.payload_json,
    signature: row.signature,
    certSerial: row.cert_serial,
    collectedAt: row.collected_at,
  };
}

/**
 * Oldest `collected_at` across included, non-removed repos of non-suspended
 * installations — the `/healthz` lag input. `null` when no stats exist yet
 * (SPEC.md §5). Pure query: the caller computes `now - oldest`.
 */
export async function selectOldestCollectedAt(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT MIN(s.collected_at) AS oldest
       FROM stats s
       JOIN repos r ON r.id = s.repo_id
       JOIN installations i ON i.id = r.installation_id
       WHERE r.included = 1 AND r.removed_at IS NULL AND i.suspended_at IS NULL`,
    )
    .first<{ oldest: string | null }>();
  return row?.oldest ?? null;
}

/** Batched upsert of multiple repos' stats snapshots in one round trip (one installation's collector pass). */
export async function upsertStatsBatch(db: D1Database, inputs: StatsInput[]): Promise<void> {
  if (inputs.length === 0) return;
  const statement = db.prepare(
    `INSERT INTO stats (
       repo_id, collected_at, commits, last_commit_at, open_issues, open_prs,
       repo_created_at, first_commit_at, size_kb, primary_language, language_pct,
       languages_json, payload_json, signature, cert_serial
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
     ON CONFLICT(repo_id) DO UPDATE SET
       collected_at = excluded.collected_at,
       commits = excluded.commits,
       last_commit_at = excluded.last_commit_at,
       open_issues = excluded.open_issues,
       open_prs = excluded.open_prs,
       repo_created_at = excluded.repo_created_at,
       first_commit_at = excluded.first_commit_at,
       size_kb = excluded.size_kb,
       primary_language = excluded.primary_language,
       language_pct = excluded.language_pct,
       languages_json = excluded.languages_json,
       payload_json = excluded.payload_json,
       signature = excluded.signature,
       cert_serial = excluded.cert_serial`,
  );
  await db.batch(
    inputs.map((input) =>
      statement.bind(
        input.repoId,
        input.collectedAt,
        input.commits,
        input.lastCommitAt,
        input.openIssues,
        input.openPrs,
        input.repoCreatedAt,
        input.firstCommitAt,
        input.sizeKb,
        input.primaryLanguage,
        input.languagePct,
        JSON.stringify(input.languages),
        input.payloadJson,
        input.signature,
        input.certSerial,
      ),
    ),
  );
}
