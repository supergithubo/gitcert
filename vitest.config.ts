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
      // Favicon asset text — the layout test asserts it stays byte-identical
      // to the canonical seal geometry (sealSvg), never a redrawn copy.
      const faviconSvg = await fs.readFile(path.join(rootDir, 'public/favicon.svg'), 'utf8');
      // COMPILED stylesheet (build:css output, a tracked artifact). Markup
      // tests can't catch a stale build: utilities referenced in JSX but
      // absent here silently no-op in the browser (the footer once rendered
      // stacked+centered at desktop because sm:flex-row was never compiled).
      const compiledCss = await fs.readFile(path.join(rootDir, 'public/styles.css'), 'utf8');
      return {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            TEST_APP_CSS: appCss,
            TEST_FAVICON_SVG: faviconSvg,
            TEST_COMPILED_CSS: compiledCss,
          },
        },
      };
    }),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
  },
});
