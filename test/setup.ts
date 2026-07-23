import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import { applyD1Migrations, env } from 'cloudflare:test';
import type { Env as WorkerEnv } from '../src/env';
import {
  TEST_GITHUB_APP_ID,
  TEST_GITHUB_APP_PRIVATE_KEY,
  TEST_GITHUB_CLIENT_ID,
  TEST_GITHUB_CLIENT_SECRET,
  TEST_GITHUB_WEBHOOK_SECRET,
  TEST_SESSION_SECRET,
  TEST_SIGNING_KEY,
} from './fixtures/secrets';

// `Cloudflare.Env` (the type of `cloudflare:test`'s `env`) is an empty
// interface meant to be extended per-project via declaration merging. This
// wires it to our real `Env` plus the test-only `TEST_MIGRATIONS` binding
// injected by vitest.config.ts (readD1Migrations).
declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

// Applies migrations/0001_init.sql (and any later migrations) to the
// isolated per-test D1 instance before each test file runs, so tests never
// drift from the real schema.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// Synthetic secret/var bindings so the full suite is self-sufficient with no
// `.dev.vars` on disk (real secrets stay an operator-provisioned, per-dev
// file — see `.dev.vars.example`). Individual test files may still override
// these in their own `beforeEach` for a specific fixture; this just gives
// every test file a working default so routes/collector code that reads
// `env.*` doesn't 500 on an empty string.
env.GITHUB_WEBHOOK_SECRET = TEST_GITHUB_WEBHOOK_SECRET;
env.SIGNING_KEY = TEST_SIGNING_KEY;
env.GITHUB_APP_ID = TEST_GITHUB_APP_ID;
env.GITHUB_APP_PRIVATE_KEY = TEST_GITHUB_APP_PRIVATE_KEY;
env.GITHUB_CLIENT_ID = TEST_GITHUB_CLIENT_ID;
env.GITHUB_CLIENT_SECRET = TEST_GITHUB_CLIENT_SECRET;
env.SESSION_SECRET = TEST_SESSION_SECRET;
