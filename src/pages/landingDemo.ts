/**
 * Constant demo badges for the landing page (M4 spec §Step 1). Rendered
 * through the REAL production templates (`renderBadge`) — no forked badge
 * markup — from pure constants: no D1, no clock, no GitHub. Identity stays
 * anonymized (`johndoe/client-platform`, design decision #2) and values
 * follow production formatting (`1,247` not `1.2k`; the `issues` slug;
 * relative `last-commit` — the M2 "code beats mock blobs" precedent).
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

/**
 * One demo badge through the production pipeline: `metricLabel` label,
 * `theme: 'auto'` (follows the page's prefers-color-scheme), normal state,
 * and the badge route's title composition.
 */
function demoBadge(metric: Metric, value: string, style: BadgeStyle): string {
  const label = metricLabel(metric);
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

/** Hero row: commits · open issues · first commit · language pills. */
export const HERO_PILLS: readonly string[] = [
  demoBadge('commits', '1,247', 'pill'),
  demoBadge('issues', '3', 'pill'),
  demoBadge('first-commit', 'Feb 2023', 'pill'),
  demoBadge('language', 'TypeScript 81%', 'pill'),
];

/**
 * "In your README" card: flat badges. `last-commit` is a constant matching
 * `formatRelative`'s 1-day output.
 */
export const README_FLATS: readonly string[] = [
  demoBadge('commits', '1,247', 'flat'),
  demoBadge('last-commit', '1d ago', 'flat'),
  demoBadge('first-commit', 'Feb 2023', 'flat'),
  demoBadge('language', 'TypeScript 81%', 'flat'),
];

/** "Inline on your site" links-row pills (no attestation link — decision #4). */
export const INLINE_PILLS: readonly string[] = [
  demoBadge('commits', '1,247', 'pill'),
  demoBadge('issues', '3', 'pill'),
];
