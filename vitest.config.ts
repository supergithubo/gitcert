import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrationsPath = path.join(rootDir, 'migrations');
      const migrations = await readD1Migrations(migrationsPath);
      // Source stylesheet text for the theme-plumbing tests (workerd has no
      // fs and `?raw` imports resolve empty in this pool) — same pattern as
      // TEST_MIGRATIONS: read at config time, expose as a test-only binding.
      const appCss = await fs.readFile(path.join(rootDir, 'src/styles/app.css'), 'utf8');
      return {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, TEST_APP_CSS: appCss },
        },
      };
    }),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
  },
});
