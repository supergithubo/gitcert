import type { PublicStats } from '../../src/lib/types';
import type {
  BadgeProps,
  BadgeState,
  BadgeStyle,
  BadgeTheme,
  Metric,
} from '../../src/badges/types';
import { metricLabel, metricValue } from '../../src/badges/value';
import { languageChipColor } from '../../src/badges/theme';

export const NOW = '2026-07-22T12:00:00Z';

export const ALL_METRICS: Metric[] = [
  'commits',
  'last-commit',
  'issues',
  'open-prs',
  'language',
  'created',
  'first-commit',
  'size',
];

export function fixtureStats(overrides: Partial<PublicStats> = {}): PublicStats {
  return {
    commits: 1247,
    lastCommitAt: '2026-07-19T12:00:00Z',
    openIssues: 3,
    openPrs: 0,
    repoCreatedAt: '2023-02-14T08:30:12Z',
    firstCommitAt: '2023-02-14T09:02:57Z',
    sizeKb: 48_128,
    primaryLanguage: 'TypeScript',
    languagePct: 81.2,
    languages: [{ name: 'TypeScript', pct: 81.2 }],
    ...overrides,
  };
}

/** Builds template props the way a route handler would (frozen contract). */
export function badgeProps(
  metric: Metric,
  kind: BadgeState['kind'],
  style: BadgeStyle,
  theme: BadgeTheme,
  labelOverride?: string,
): BadgeProps {
  const stats = fixtureStats();
  const label = labelOverride ?? metricLabel(metric);
  const value = metricValue(metric, stats, NOW);
  const state: BadgeState =
    kind === 'normal' || kind === 'stale'
      ? { kind, value, langChip: languageChipColor(stats.primaryLanguage) }
      : { kind };
  const titleValue =
    kind === 'collecting' ? 'collecting…' : kind === 'not-found' ? 'not found' : value;
  return {
    metric,
    label,
    state,
    style,
    theme,
    title: `wnston/client-platform: ${titleValue} ${label} (attested by gitcert)`,
  };
}

/** Extracts the ordered numeric geometry attribute sequence of an SVG string. */
export function geometrySignature(svg: string): string[] {
  return svg.match(/\b(?:x|y|width|height|rx|cx|cy|r|x1|x2|y1|y2)="[-\d.]+"/g) ?? [];
}
