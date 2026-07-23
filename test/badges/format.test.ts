import { describe, expect, it } from 'vitest';
import {
  escapeXml,
  formatCount,
  formatFullDate,
  formatMonthYear,
  formatRelative,
  formatSizeKb,
  formatTimestampUtc,
} from '../../src/badges/format';

describe('formatCount', () => {
  it('renders zero exactly', () => {
    expect(formatCount(0)).toBe('0');
  });

  it('keeps counts below 10,000 exact with thousands separator', () => {
    expect(formatCount(1247)).toBe('1,247');
    expect(formatCount(999)).toBe('999');
  });

  it('holds the exact format up to the 9,999/10,000 boundary', () => {
    expect(formatCount(9999)).toBe('9,999');
    expect(formatCount(10000)).toBe('10k');
  });

  it('rounds to whole k above 10k', () => {
    expect(formatCount(12345)).toBe('12k');
    expect(formatCount(999_449)).toBe('999k');
  });

  it('promotes k-rounding overflow into the M bucket', () => {
    expect(formatCount(999_500)).toBe('1M');
  });

  it('renders millions with one trimmed decimal', () => {
    expect(formatCount(1_000_000)).toBe('1M');
    expect(formatCount(1_234_567)).toBe('1.2M');
  });
});

describe('formatMonthYear', () => {
  it('renders Mon YYYY in UTC', () => {
    expect(formatMonthYear('2023-02-14T08:30:12Z')).toBe('Feb 2023');
    expect(formatMonthYear('2026-12-31T23:59:59Z')).toBe('Dec 2026');
  });

  it('renders an em dash for null dates', () => {
    expect(formatMonthYear(null)).toBe('—');
  });
});

describe('formatFullDate', () => {
  it('renders Mon D, YYYY in UTC', () => {
    expect(formatFullDate('2023-02-14T08:30:12Z')).toBe('Feb 14, 2023');
  });

  it('renders an em dash for null dates', () => {
    expect(formatFullDate(null)).toBe('—');
  });
});

describe('formatTimestampUtc', () => {
  it('renders the certificate attested format', () => {
    expect(formatTimestampUtc('2026-07-22T14:03:00Z')).toBe('Jul 22 2026, 14:03 UTC');
  });

  it('zero-pads hours and minutes', () => {
    expect(formatTimestampUtc('2026-01-05T04:07:00Z')).toBe('Jan 5 2026, 04:07 UTC');
  });
});

describe('formatRelative', () => {
  const now = '2026-07-22T12:00:00Z';

  it('renders just now under a minute', () => {
    expect(formatRelative('2026-07-22T11:59:30Z', now)).toBe('just now');
  });

  it('renders minutes, hours, and days', () => {
    expect(formatRelative('2026-07-22T11:15:00Z', now)).toBe('45m ago');
    expect(formatRelative('2026-07-22T07:00:00Z', now)).toBe('5h ago');
    expect(formatRelative('2026-07-19T12:00:00Z', now)).toBe('3d ago');
  });

  it('rolls days into months and years', () => {
    expect(formatRelative('2026-05-01T12:00:00Z', now)).toBe('2mo ago');
    expect(formatRelative('2024-07-01T12:00:00Z', now)).toBe('2y ago');
  });

  it('renders an em dash for null dates', () => {
    expect(formatRelative(null, now)).toBe('—');
  });
});

describe('formatSizeKb', () => {
  it('renders KB below one MB', () => {
    expect(formatSizeKb(0)).toBe('0 KB');
    expect(formatSizeKb(512)).toBe('512 KB');
    expect(formatSizeKb(1023)).toBe('1023 KB');
  });

  it('renders whole MB below one GB', () => {
    expect(formatSizeKb(1024)).toBe('1 MB');
    expect(formatSizeKb(48_128)).toBe('47 MB');
  });

  it('renders GB with one trimmed decimal', () => {
    expect(formatSizeKb(1024 * 1024)).toBe('1 GB');
    expect(formatSizeKb(Math.round(1.2 * 1024 * 1024))).toBe('1.2 GB');
  });

  it('renders an em dash for null sizes', () => {
    expect(formatSizeKb(null)).toBe('—');
  });
});

describe('escapeXml', () => {
  it('escapes all five XML special characters', () => {
    expect(escapeXml(`<img src="x" onerror='a' & b>`)).toBe(
      '&lt;img src=&quot;x&quot; onerror=&apos;a&apos; &amp; b&gt;',
    );
  });

  it('passes plain strings through unchanged', () => {
    expect(escapeXml('client-platform')).toBe('client-platform');
  });
});
