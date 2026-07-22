-- migrations/0001_init.sql
-- M1: installations, repos, stats — SPEC.md §4 (as amended 2026-07-23:
-- 8 metrics, no closed_issues/merged_prs; open_prs, repo_created_at,
-- first_commit_at, size_kb present).

CREATE TABLE installations (
  id            INTEGER PRIMARY KEY,           -- GitHub installation id
  account_login TEXT NOT NULL,                 -- user/org the app is installed on
  account_id    INTEGER NOT NULL,
  account_type  TEXT NOT NULL DEFAULT 'User',  -- User | Organization
  suspended_at  TEXT,                          -- ISO; set on suspend/uninstall
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE repos (
  id              INTEGER PRIMARY KEY,         -- GitHub repo id (stable across renames)
  installation_id INTEGER NOT NULL REFERENCES installations(id),
  owner           TEXT NOT NULL,
  name            TEXT NOT NULL,
  private         INTEGER NOT NULL DEFAULT 1,
  included        INTEGER NOT NULL DEFAULT 1,  -- owner toggle: expose publicly?
  removed_at      TEXT,                        -- set when repo leaves the installation
  UNIQUE(owner, name)
);
CREATE INDEX idx_repos_installation ON repos(installation_id);

CREATE TABLE stats (
  repo_id          INTEGER PRIMARY KEY REFERENCES repos(id),  -- latest snapshot only
  collected_at     TEXT NOT NULL,              -- ISO UTC
  commits          INTEGER NOT NULL,           -- default branch history totalCount
  last_commit_at   TEXT,
  open_issues      INTEGER NOT NULL DEFAULT 0,
  open_prs         INTEGER NOT NULL DEFAULT 0,
  repo_created_at  TEXT,                        -- GitHub createdAt
  first_commit_at  TEXT,                        -- oldest default-branch commit; cached once known (§6)
  size_kb          INTEGER,                     -- GitHub diskUsage (KB)
  primary_language TEXT,
  language_pct     REAL,                       -- primary language share, 0..100
  languages_json   TEXT,                       -- top 5 [{name, pct}]
  payload_json     TEXT NOT NULL,              -- exact canonical JSON that was signed
  signature        TEXT NOT NULL,              -- base64 ed25519 over payload_json
  cert_serial      TEXT NOT NULL               -- e.g. GC-7F2A41
);
