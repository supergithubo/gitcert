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
