/**
 * Guards the app.css theme plumbing that the header toggle depends on:
 * the [data-gc-theme] attribute scopes must override the media default,
 * and the `--gc-*` svg overrides (which re-color INLINE auto-theme badges
 * when the toggle flips) must stay in sync with src/badges/theme.ts —
 * they are hand-mirrored values, so drift there silently breaks toggle
 * re-coloring of the landing demo badges.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { ACCENT_GREEN, FLAT_COLORS, PILL_COLORS } from '../../src/badges/theme';

/** Whitespace-insensitive containment (prettier reformats rgba/blocks). */
const css = env.TEST_APP_CSS.replace(/\s+/g, '');
const has = (fragment: string) => css.includes(fragment.replace(/\s+/g, ''));

describe('app.css theme scopes', () => {
  it('defines attribute scopes that override the prefers-color-scheme default', () => {
    expect(has(":root,:root[data-gc-theme='light']{")).toBe(true);
    expect(has('@media(prefers-color-scheme:dark){:root{')).toBe(true);
    expect(has(":root[data-gc-theme='dark']{")).toBe(true);
  });

  it('swaps the toggle icon from the effective theme', () => {
    expect(has("[data-theme-icon='sun']{display:none;}")).toBe(true);
    expect(has(":root[data-gc-theme='dark'] [data-theme-icon='sun']{display:block;}")).toBe(true);
    expect(has(":root[data-gc-theme='light'] [data-theme-icon='moon']{display:block;}")).toBe(true);
  });
});

describe('app.css docs scrollspy active-nav rule (issue #1)', () => {
  it('defines the unlayered [data-spy-link][data-active] accent/ink rule', () => {
    // Unlayered so it out-cascades the link's layered border-transparent /
    // text-muted utilities (same trick as the account-caret rule). Source form.
    expect(has('[data-spy-link][data-active]{border-color:var(--accent);color:var(--ink);}')).toBe(
      true,
    );
  });

  it('survives build:css into the compiled stylesheet (stale-build guard)', () => {
    // The compiled artifact is what the browser loads — a source-only rule that
    // never made it through build:css would silently no-op the highlight.
    const compiled = env.TEST_COMPILED_CSS.replace(/\s+/g, '');
    expect(compiled).toContain(
      '[data-spy-link][data-active]{border-color:var(--accent);color:var(--ink)}',
    );
  });
});

describe('app.css shared motion primitives', () => {
  /**
   * Compiled containment. `--minify` strips the quotes off attribute values
   * (`[data-copy-phase='done']` → `[data-copy-phase=done]`), so the compiled
   * side is compared quote- and whitespace-insensitively; the source side keeps
   * its prettier-formatted quotes.
   */
  const loose = (s: string) => s.replace(/\s+/g, '').replace(/'/g, '');
  const compiled = loose(env.TEST_COMPILED_CSS);
  const inBoth = (fragment: string) => has(fragment) && compiled.includes(loose(fragment));

  it('defines the seal hover-draw keyframe and its hook', () => {
    expect(has('@keyframes gcdraw')).toBe(true);
    expect(has('[data-seal-check]{stroke-dasharray:9;stroke-dashoffset:0;}')).toBe(true);
    expect(has('svg:hover [data-seal-check]{animation:gcdraw 0.42s ease;}')).toBe(true);
  });

  it('defines the shared success-check keyframe with fill-mode both', () => {
    expect(has('@keyframes gccheckdraw')).toBe(true);
    expect(has('[data-gc-check]{')).toBe(true);
    expect(has('stroke-dasharray:27;')).toBe(true);
    expect(has('both')).toBe(true);
  });

  it.each([
    ['gcdraw', '@keyframes gcdraw'],
    ['gccheckdraw', '@keyframes gccheckdraw'],
    ['[data-seal-check]', '[data-seal-check]'],
    ['[data-gc-check]', '[data-gc-check]'],
    ['copy phase', "[data-copy-phase='done'] [data-copy-icon='done']"],
    ['sync phase', "[data-sync-phase='done'] [data-sync-icon='done']"],
    ['verify phase', "[data-verify-phase='done'] [data-verify-valid]"],
    ['chevron', "[aria-expanded='false'] [data-acct-chevron]"],
  ] as const)('survives build:css into the compiled stylesheet — %s', (_label, fragment) => {
    // public/styles.css is the artifact the browser loads: a source-only rule
    // that never made it through `npm run build:css` silently no-ops.
    expect(inBoth(fragment), `missing ${fragment} — run npm run build:css`).toBe(true);
  });

  it('gives every new animation hook a prefers-reduced-motion entry', () => {
    const at = css.indexOf('@media(prefers-reduced-motion:reduce){');
    expect(at).toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf('}}', at));
    for (const hook of ['[data-gc-check]', '[data-seal-check]', '[data-acct-chevron]']) {
      expect(block, `${hook} has no reduced-motion entry`).toContain(hook);
    }
    expect(block).toContain('animation:none');
    expect(block).toContain('transition:none');
  });

  it('keeps the shipped 0.9s spin — the mock’s .8s is mock-local', () => {
    expect(has('[data-gc-spin]{animation:gcspin 0.9s linear infinite;}')).toBe(true);
    expect(has('gcspin 0.8s')).toBe(false);
  });
});

describe('app.css --gc-* overrides mirror src/badges/theme.ts', () => {
  const flatNormal = FLAT_COLORS.value.normal;

  it('defines both svg attribute scopes', () => {
    expect(has(":root[data-gc-theme='light']svg{")).toBe(true);
    expect(has(":root[data-gc-theme='dark']svg{")).toBe(true);
  });

  it.each([
    ['labelBg', FLAT_COLORS.labelBg],
    ['labelText', FLAT_COLORS.labelText],
    ['valueBg', flatNormal.bg],
    ['valueText', flatNormal.text],
    ['seal', flatNormal.seal],
    ['bg', PILL_COLORS.bg],
    ['border', PILL_COLORS.border],
    ['tx', PILL_COLORS.text],
    ['muted', PILL_COLORS.muted],
  ] as const)('mirrors --gc-%s for both themes', (role, duotone) => {
    expect(has(`--gc-${role}:${duotone.light}`)).toBe(true);
    expect(has(`--gc-${role}:${duotone.dark}`)).toBe(true);
  });

  it('keeps the accent constant for the normal value segment', () => {
    expect(has(`--gc-valueBg:${ACCENT_GREEN}`)).toBe(true);
  });
});
