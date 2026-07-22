import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import { applyD1Migrations, env } from 'cloudflare:test';
import type { Env as WorkerEnv } from '../src/env';

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
