/**
 * Copy-snippet builders — the single source of the snippet contract
 * (M3 spec §Copy-snippet contract; design-brief §Copy-snippet formats).
 * The dashboard renders the placeholder templates into its JSON state
 * block and the inline script substitutes placeholders — the formats
 * never exist twice. Pure string logic: no D1, no env, no fetch.
 */

import type { BadgeStyle, BadgeTheme, Metric } from '../badges/types';

/** Canonical public base URL — snippets always use it, even in dev. */
export const SNIPPET_BASE_URL = 'https://gitcert.harborstack.app';

/**
 * Relative badge path template — also used by the dashboard preview
 * `<img>` (relative so the preview hits the current origin).
 */
export const BADGE_PATH_TEMPLATE = '/b/{OWNER}/{REPO}/{METRIC}.svg?style={STYLE}&theme={THEME}';

/** Relative verify path template. */
export const VERIFY_PATH_TEMPLATE = '/verify/{OWNER}/{REPO}';

const BADGE_URL = `${SNIPPET_BASE_URL}${BADGE_PATH_TEMPLATE}`;
const VERIFY_URL = `${SNIPPET_BASE_URL}${VERIFY_PATH_TEMPLATE}`;

/** Alt text carries the human label, never live numbers (spec Decision 12). */
const ALT_TEXT = '{LABEL} — attested by GitCert';

/**
 * Placeholder-form snippet templates. Placeholders: `{OWNER}` `{REPO}`
 * `{METRIC}` `{LABEL}` `{STYLE}` `{THEME}`. `react` is plain JSX at M3
 * (registry upgrade is M5). Line breaks/indentation are part of the
 * contract — pinned by test/pages/snippets.test.ts.
 */
export const SNIPPET_TEMPLATES = {
  md: `[![{LABEL}](${BADGE_URL})](${VERIFY_URL})`,
  html: `<a href="${VERIFY_URL}">\n  <img src="${BADGE_URL}"\n       alt="${ALT_TEXT}" />\n</a>`,
  react: `<a href="${VERIFY_URL}">\n  <img\n    src="${BADGE_URL}"\n    alt="${ALT_TEXT}"\n  />\n</a>`,
} as const;

export type SnippetKind = keyof typeof SNIPPET_TEMPLATES;

export interface SnippetParams {
  owner: string;
  repo: string;
  metric: Metric;
  /** Human metric label (`metricLabel`), e.g. `issues` → "open issues". */
  label: string;
  style: BadgeStyle;
  theme: BadgeTheme;
}

/** Substitutes the six placeholders — the same dumb replacement the inline script performs. */
export function fillSnippetTemplate(template: string, params: SnippetParams): string {
  const values: Record<string, string> = {
    OWNER: params.owner,
    REPO: params.repo,
    METRIC: params.metric,
    LABEL: params.label,
    STYLE: params.style,
    THEME: params.theme,
  };
  return template.replace(/\{(OWNER|REPO|METRIC|LABEL|STYLE|THEME)\}/g, (match, key: string) => {
    return values[key] ?? match;
  });
}

/** Concrete md/html/react snippets for one badge configuration. */
export function buildSnippets(params: SnippetParams): Record<SnippetKind, string> {
  return {
    md: fillSnippetTemplate(SNIPPET_TEMPLATES.md, params),
    html: fillSnippetTemplate(SNIPPET_TEMPLATES.html, params),
    react: fillSnippetTemplate(SNIPPET_TEMPLATES.react, params),
  };
}
