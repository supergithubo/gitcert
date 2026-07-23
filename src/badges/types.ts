/**
 * Frozen badge interface contract (M2 spec §Interface Contract). Backend
 * route handlers construct these props; templates render them. Templates are
 * pure — no D1, no clocks, no env access.
 */

/** The eight public badge metrics (SPEC.md §5 route slugs). */
export type Metric =
  | 'commits'
  | 'last-commit'
  | 'issues'
  | 'open-prs'
  | 'language'
  | 'created'
  | 'first-commit'
  | 'size';

export type BadgeStyle = 'flat' | 'pill';

export type BadgeTheme = 'light' | 'dark' | 'auto';

/**
 * Designed badge states. `normal`/`stale` carry the pre-formatted value
 * string (derived by the caller via `metricValue`) and, for the language
 * metric, an optional linguist chip color. `collecting` and `not-found`
 * carry no data — `not-found` is cause-blind by contract (no existence
 * oracle).
 */
export type BadgeState =
  | { kind: 'normal' | 'stale'; value: string; langChip?: string | null }
  | { kind: 'collecting' }
  | { kind: 'not-found' };

export interface BadgeProps {
  metric: Metric;
  label: string;
  state: BadgeState;
  style: BadgeStyle;
  theme: BadgeTheme;
  /** Accessible title, e.g. `"owner/repo: 1,247 commits (attested by gitcert)"`. */
  title: string;
}
