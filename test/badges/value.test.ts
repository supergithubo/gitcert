import { describe, expect, it } from 'vitest';
import type { PublicStats } from '../../src/lib/types';
import { metricLabel, metricMeta, metricValue } from '../../src/badges/value';
import type { Metric } from '../../src/badges/types';

const NOW = '2026-07-22T12:00:00Z';

function fixtureStats(overrides: Partial<PublicStats> = {}): PublicStats {
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

describe('metricValue', () => {
  it('derives every metric value per SPEC §8', () => {
    const stats = fixtureStats();
    const expected: Record<Metric, string> = {
      commits: '1,247',
      'last-commit': '3d ago',
      issues: '3',
      'open-prs': '0',
      language: 'TypeScript 81%',
      created: 'Feb 2023',
      'first-commit': 'Feb 2023',
      size: '47 MB',
    };
    for (const [metric, value] of Object.entries(expected)) {
      expect(metricValue(metric as Metric, stats, NOW)).toBe(value);
    }
  });

  it('rounds language pct to an integer', () => {
    expect(metricValue('language', fixtureStats({ languagePct: 80.5 }), NOW)).toBe(
      'TypeScript 81%',
    );
  });

  it('degrades gracefully when language data is missing', () => {
    expect(metricValue('language', fixtureStats({ primaryLanguage: null }), NOW)).toBe('—');
    expect(metricValue('language', fixtureStats({ languagePct: null }), NOW)).toBe('TypeScript');
  });

  it('renders em dashes for null dates and size', () => {
    const empty = fixtureStats({
      lastCommitAt: null,
      repoCreatedAt: null,
      firstCommitAt: null,
      sizeKb: null,
    });
    expect(metricValue('last-commit', empty, NOW)).toBe('—');
    expect(metricValue('created', empty, NOW)).toBe('—');
    expect(metricValue('first-commit', empty, NOW)).toBe('—');
    expect(metricValue('size', empty, NOW)).toBe('—');
  });

  it('renders zero counts exactly', () => {
    const zero = fixtureStats({ commits: 0, openIssues: 0, openPrs: 0 });
    expect(metricValue('commits', zero, NOW)).toBe('0');
    expect(metricValue('issues', zero, NOW)).toBe('0');
    expect(metricValue('open-prs', zero, NOW)).toBe('0');
  });
});

describe('metricLabel', () => {
  it('maps route slugs to rendered labels', () => {
    expect(metricLabel('issues')).toBe('open issues');
    expect(metricLabel('open-prs')).toBe('open PRs');
    expect(metricLabel('last-commit')).toBe('last commit');
    expect(metricLabel('first-commit')).toBe('first commit');
    expect(metricLabel('commits')).toBe('commits');
    expect(metricLabel('language')).toBe('language');
    expect(metricLabel('created')).toBe('created');
    expect(metricLabel('size')).toBe('size');
  });
});

describe('metricMeta', () => {
  it('marks only issues and open PRs as status metrics', () => {
    expect(metricMeta('issues')).toEqual({ icon: 'wrench', status: true });
    expect(metricMeta('open-prs')).toEqual({ icon: 'gitmerge', status: true });
    expect(metricMeta('commits')).toEqual({ icon: 'branch', status: false });
    expect(metricMeta('last-commit')).toEqual({ icon: 'clock', status: false });
    expect(metricMeta('language')).toEqual({ icon: 'lang', status: false });
    expect(metricMeta('created')).toEqual({ icon: 'calendar', status: false });
    expect(metricMeta('first-commit')).toEqual({ icon: 'branch', status: false });
    expect(metricMeta('size')).toEqual({ icon: 'box', status: false });
  });
});
