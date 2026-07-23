/**
 * Badge color tables, ported verbatim from the specimen ternaries in
 * `artifacts/design/badges.dc.html` (`flatBadge`/`pillBadge`). Geometry is
 * identical across themes; only these colors swap. `theme=auto` resolves
 * every role to a CSS custom property backed by an internal
 * `prefers-color-scheme` media query.
 */

import type { BadgeTheme } from './types';

/** One color role with its light/dark values. */
export interface Duotone {
  light: string;
  dark: string;
}

const constant = (value: string): Duotone => ({ light: value, dark: value });

/** Specimen accent constant — used for badges in BOTH themes (spec §Design Porting). */
export const ACCENT_GREEN = '#2f6d4f';

/** Status-dot attention color (open issues/PRs > 0) — both themes. */
export const AMBER = '#9a6b1f';

/** Flat badge palette per state (label segment is state-independent). */
export const FLAT_COLORS = {
  labelBg: { light: '#4b4a45', dark: '#33322e' },
  labelText: { light: '#f2f0ea', dark: '#dcdad2' },
  value: {
    normal: { bg: constant(ACCENT_GREEN), text: constant('#ffffff'), seal: constant('#ffffff') },
    stale: {
      bg: { light: '#54675c', dark: '#495a51' },
      text: { light: '#d6dcd5', dark: '#a7aea6' },
      seal: { light: '#d6dcd5', dark: '#a7aea6' },
    },
    collecting: { bg: { light: '#6f6e67', dark: '#57554f' }, text: constant('#ffffff') },
    'not-found': {
      bg: { light: '#7d7c74', dark: '#46443f' },
      text: { light: '#f4f2ec', dark: '#c9c7bf' },
    },
  },
} as const;

/** Pill badge palette (state-specific text overrides applied in pill.ts). */
export const PILL_COLORS = {
  bg: { light: '#faf9f6', dark: '#232220' },
  border: { light: 'rgba(28,27,25,0.16)', dark: 'rgba(232,230,224,0.22)' },
  text: { light: '#24231f', dark: '#e8e6e0' },
  muted: { light: '#6c6b63', dark: '#a29f96' },
  staleText: { light: '#4a4842', dark: '#bab7ad' },
} as const;

/**
 * Small linguist color map for the pill language chip (spec §Design
 * Porting). Unknown languages fall back to the muted dot color (null).
 */
const LANGUAGE_CHIP_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Rust: '#dea584',
  Python: '#3572A5',
  Go: '#00ADD8',
  Java: '#b07219',
  C: '#555555',
  'C++': '#f34b7d',
  'C#': '#178600',
  Ruby: '#701516',
  PHP: '#4F5D95',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  HTML: '#e34c26',
  CSS: '#663399',
  Shell: '#89e051',
};

/** Chip color for a primary language, or null to use the theme's muted dot color. */
export function languageChipColor(language: string | null): string | null {
  if (language === null) return null;
  return LANGUAGE_CHIP_COLORS[language] ?? null;
}

export interface ResolvedColors {
  /** Resolved color per role — a literal for light/dark, a `var(...)` for auto. */
  color: Record<string, string>;
  /** CSS rules defining the auto-theme custom properties (empty for light/dark). */
  themeCss: string;
}

/**
 * Resolves a role→Duotone map for a theme. For `auto`, every role becomes
 * `var(--gc-<role>)` and `themeCss` carries both tables behind a
 * `prefers-color-scheme` media query (geometry never changes — svg-badges
 * rules).
 */
export function resolveColors(roles: Record<string, Duotone>, theme: BadgeTheme): ResolvedColors {
  const names = Object.keys(roles).sort();
  if (theme !== 'auto') {
    const color: Record<string, string> = {};
    for (const name of names) color[name] = roles[name]![theme];
    return { color, themeCss: '' };
  }
  const color: Record<string, string> = {};
  const light: string[] = [];
  const dark: string[] = [];
  for (const name of names) {
    const varName = `--gc-${name}`;
    color[name] = `var(${varName})`;
    light.push(`${varName}:${roles[name]!.light}`);
    dark.push(`${varName}:${roles[name]!.dark}`);
  }
  const themeCss = `svg{${light.join(';')}}@media(prefers-color-scheme:dark){svg{${dark.join(';')}}}`;
  return { color, themeCss };
}
