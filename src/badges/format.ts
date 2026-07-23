/**
 * Value formatting per SPEC.md §8 (the contract — mock data blobs are
 * non-binding). All functions are pure; relative dates take the current
 * instant as an argument (svg-badges rules: templates never read clocks).
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Placeholder for stats the collector could not derive (e.g. empty repo dates). */
const MISSING = '—';

/**
 * Counts: exact with thousands separator below 10,000 (`1,247`), then
 * `12k`, then `1.2M`.
 */
export function formatCount(n: number): string {
  if (n >= 1_000_000) return formatScaled(n, 1_000_000, 'M');
  if (n >= 10_000) {
    const thousands = Math.round(n / 1_000);
    // Rounding can carry 999,500+ into the M bucket.
    if (thousands >= 1_000) return formatScaled(n, 1_000_000, 'M');
    return `${thousands}k`;
  }
  return n.toLocaleString('en-US');
}

/** One-decimal scaled value with a trailing `.0` trimmed (`1.2M`, `2M`). */
function formatScaled(n: number, divisor: number, suffix: string): string {
  const scaled = (n / divisor).toFixed(1);
  return `${scaled.endsWith('.0') ? scaled.slice(0, -2) : scaled}${suffix}`;
}

/** Badge date format: `Feb 2023` (UTC). Null dates render an em dash. */
export function formatMonthYear(iso: string | null): string {
  if (iso === null) return MISSING;
  const date = new Date(iso);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** Certificate date format: `Feb 14, 2023` (UTC). */
export function formatFullDate(iso: string | null): string {
  if (iso === null) return MISSING;
  const date = new Date(iso);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

/** Certificate attested-row format: `Jul 22 2026, 14:03 UTC`. */
export function formatTimestampUtc(iso: string): string {
  const date = new Date(iso);
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()} ${date.getUTCFullYear()}, ${hours}:${minutes} UTC`;
}

/**
 * Relative time for `last-commit` (`3d ago`), computed against an injected
 * now. Future or sub-minute differences render `just now`.
 */
export function formatRelative(iso: string | null, nowIso: string): string {
  if (iso === null) return MISSING;
  const seconds = Math.floor((Date.parse(nowIso) - Date.parse(iso)) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** Humanizes `size_kb`: `512 KB` · `47 MB` · `1.2 GB`. */
export function formatSizeKb(kb: number | null): string {
  if (kb === null) return MISSING;
  if (kb >= 1024 * 1024) return `${trimDecimal((kb / (1024 * 1024)).toFixed(1))} GB`;
  if (kb >= 1024) return `${Math.round(kb / 1024)} MB`;
  return `${kb} KB`;
}

function trimDecimal(value: string): string {
  return value.endsWith('.0') ? value.slice(0, -2) : value;
}

/** Escapes a string for embedding in SVG/XML text nodes and attributes. */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
