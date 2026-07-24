/**
 * Constant demo badges for the /docs "The badges" reference table (spec
 * §Step 2). Rendered through the REAL production templates (`renderBadge`) —
 * no forked badge markup — from pure constants: no D1, no clock, no GitHub.
 * Every one of the eight metrics is shown in both styles, so the docs table
 * is 8 metrics × {flat, pill} = 16 live SVGs.
 *
 * Identity stays anonymized (`johndoe/client-platform`, design decision #2)
 * and values follow production formatting (`1,247` not `1.2k`; the `issues`
 * slug label; relative `last-commit`) — mirroring landingDemo.ts, the "code
 * beats mock blobs" precedent.
 */

import { renderBadge } from '../badges/render';
import { languageChipColor } from '../badges/theme';
import type { BadgeStyle, Metric } from '../badges/types';
import { metricLabel } from '../badges/value';

/** Anonymized demo identity — never swapped for real user data. */
export const DEMO_REPO_SLUG = 'johndoe/client-platform';

/** Matches the badge route's title suffix (routes/badge.ts ATTESTED_BY). */
const ATTESTED_BY = 'attested by gitcert';

const DEMO_LANGUAGE = 'TypeScript';

/** Production-formatted demo value per metric (see landingDemo.ts precedent). */
const DEMO_VALUES: Record<Metric, string> = {
  commits: '1,247',
  'last-commit': '1d ago',
  issues: '3',
  'open-prs': '2',
  language: 'TypeScript 81%',
  created: 'Feb 2023',
  'first-commit': 'Feb 2023',
  size: '47 MB',
};

/** The eight badge metrics in SPEC §5 route-slug order. */
export const DOCS_METRICS: readonly Metric[] = [
  'commits',
  'last-commit',
  'issues',
  'open-prs',
  'language',
  'created',
  'first-commit',
  'size',
];

/**
 * One demo badge through the production pipeline: `metricLabel` label,
 * `theme: 'auto'` (follows the reader's prefers-color-scheme), normal state,
 * and the badge route's title composition.
 */
function demoBadge(metric: Metric, style: BadgeStyle): string {
  const label = metricLabel(metric);
  const value = DEMO_VALUES[metric];
  return renderBadge({
    metric,
    label,
    state: {
      kind: 'normal',
      value,
      langChip: metric === 'language' ? languageChipColor(DEMO_LANGUAGE) : null,
    },
    style,
    theme: 'auto',
    title: `${DEMO_REPO_SLUG}: ${value} ${label} (${ATTESTED_BY})`,
  });
}

export interface DocsMetricRow {
  metric: Metric;
  /** Rendered label (`open issues`, `last commit`, …). */
  name: string;
  flat: string;
  pill: string;
}

/** The docs "The badges" table: one row per metric, both styles rendered. */
export const DOCS_METRIC_ROWS: readonly DocsMetricRow[] = DOCS_METRICS.map((metric) => ({
  metric,
  name: metricLabel(metric),
  flat: demoBadge(metric, 'flat'),
  pill: demoBadge(metric, 'pill'),
}));
