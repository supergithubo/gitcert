import type { LanguageShare } from './types';

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
 */
export async function selectStaleInstallations(
  db: D1Database,
  cutoffIso: string,
): Promise<number[]> {
  const result = await db
    .prepare(
      `SELECT DISTINCT i.id AS id
       FROM installations i
       JOIN repos r ON r.installation_id = i.id
       LEFT JOIN stats s ON s.repo_id = r.id
       WHERE i.suspended_at IS NULL
         AND r.removed_at IS NULL
         AND r.included = 1
         AND (s.collected_at IS NULL OR s.collected_at < ?1)`,
    )
    .bind(cutoffIso)
    .all<{ id: number }>();
  return result.results.map((row) => row.id);
}

/**
 * All active (non-removed) repos for an installation, joined with their
 * latest stored stats (commits, first_commit_at) so the collector can
 * decide whether a first-commit refetch is needed without a second query.
 */
export async function selectReposForInstallation(
  db: D1Database,
  installationId: number,
): Promise<RepoForCollection[]> {
  const result = await db
    .prepare(
      `SELECT r.id AS id, r.owner AS owner, r.name AS name, r.private AS private,
              s.commits AS previous_commits, s.first_commit_at AS previous_first_commit_at
       FROM repos r
       LEFT JOIN stats s ON s.repo_id = r.id
       WHERE r.installation_id = ?1 AND r.removed_at IS NULL`,
    )
    .bind(installationId)
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
