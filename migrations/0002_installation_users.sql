-- migrations/0002_installation_users.sql
-- The missing link between a signed-in person and the installations they
-- may administer (spec: artifacts/spec/overview.md — org installations in
-- the dashboard). Every owner-scoped query in src/lib/db.ts joins through
-- this table instead of comparing `installations.account_id` directly,
-- which only ever matches for a personal (User) installation — an
-- organization installation's `account_id` is the org's GitHub id, never
-- a member's, so org repos were invisible to every owner surface.

CREATE TABLE installation_users (
  installation_id INTEGER NOT NULL,
  github_user_id  INTEGER NOT NULL,
  linked_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (installation_id, github_user_id)
);
CREATE INDEX idx_installation_users_user ON installation_users(github_user_id);

-- No foreign key on `installation_id` — deliberate. `/auth/callback` and
-- the `installation created` webhook race: the callback may reconcile
-- links for an installation whose `installations` row has not landed yet.
-- An orphan link is inert (every ownership query still JOINs
-- `installations`, so an orphan link exposes nothing) and self-heals the
-- moment the webhook lands. A FK would instead fail/drop the link insert
-- and re-create the exact bug this migration fixes.

-- Backfill: every existing personal installation is administered by its
-- own account, so existing users keep working with no re-auth required.
INSERT OR IGNORE INTO installation_users (installation_id, github_user_id)
SELECT id, account_id FROM installations WHERE account_type = 'User';
