/**
 * Presentation logic: derives the rendered value string and label for each
 * metric (M2 spec §Interface Contract). Pure — `nowIso` is injected by the
 * route handler, never read here.
 */

import type { PublicStats } from '../lib/types';
import { formatCount, formatMonthYear, formatRelative, formatSizeKb } from './format';
import type { Metric } from './types';

/** Pill icon glyph names (ported from the specimen `meta` table). */
export type MetricIcon =
  'branch' | 'clock' | 'dot' | 'lang' | 'wrench' | 'gitmerge' | 'calendar' | 'box';

interface MetricMeta {
  label: string;
  icon: MetricIcon;
  /** Status metrics color the pill icon green (0) / amber (>0). */
  status: boolean;
}

/** Specimen `meta` table, keyed by the SPEC §5 route slugs (8 metrics). */
const META: Record<Metric, MetricMeta> = {
  commits: { label: 'commits', icon: 'branch', status: false },
  'last-commit': { label: 'last commit', icon: 'clock', status: false },
  issues: { label: 'open issues', icon: 'wrench', status: true },
  'open-prs': { label: 'open PRs', icon: 'gitmerge', status: true },
  language: { label: 'language', icon: 'lang', status: false },
  created: { label: 'created', icon: 'calendar', status: false },
  'first-commit': { label: 'first commit', icon: 'branch', status: false },
  size: { label: 'size', icon: 'box', status: false },
};

/** Default rendered label for a metric (`issues` → `open issues`). */
export function metricLabel(metric: Metric): string {
  return META[metric].label;
}

/** Pill icon + status-dot metadata for a metric. */
export function metricMeta(metric: Metric): { icon: MetricIcon; status: boolean } {
  const { icon, status } = META[metric];
  return { icon, status };
}

/** Derives the badge value string for a metric per SPEC.md §8 formatting. */
export function metricValue(metric: Metric, stats: PublicStats, nowIso: string): string {
  switch (metric) {
    case 'commits':
      return formatCount(stats.commits);
    case 'last-commit':
      return formatRelative(stats.lastCommitAt, nowIso);
    case 'issues':
      return formatCount(stats.openIssues);
    case 'open-prs':
      return formatCount(stats.openPrs);
    case 'language':
      return formatLanguage(stats.primaryLanguage, stats.languagePct);
    case 'created':
      return formatMonthYear(stats.repoCreatedAt);
    case 'first-commit':
      return formatMonthYear(stats.firstCommitAt);
    case 'size':
      return formatSizeKb(stats.sizeKb);
  }
}

/** `TypeScript 81%` — pct rounded to an integer; degrades when parts are missing. */
function formatLanguage(language: string | null, pct: number | null): string {
  if (language === null) return '—';
  if (pct === null) return language;
  return `${language} ${Math.round(pct)}%`;
}
