/**
 * Pill badge template — single hairline-bordered inline variant, ported
 * verbatim from the specimen `pillBadge()`/`icon()` in
 * `artifacts/design/badges.dc.html`. Geometry: H=24, rx=12, fs=11.5,
 * cw=6.9, padX=11, gap=6; icon and seal 13px. Pure function.
 * Design-tool animation hooks (`pathLength`, `data-draw`, clock hands
 * hover) were not ported — static geometry only.
 */

import { escapeXml } from './format';
import { sealSvg } from './seal';
import type { SealKind } from './seal';
import { ACCENT_GREEN, AMBER, PILL_COLORS, resolveColors } from './theme';
import type { BadgeProps } from './types';
import { metricMeta } from './value';
import type { MetricIcon } from './value';

const H = 24;
const RX = 12;
const FONT_SIZE = 11.5;
const CHAR_W = 6.9;
const PAD_X = 11;
const GAP = 6;
const ICON_SIZE = 13;
const SEAL_SIZE = 13;
const MONO = "'SF Mono',ui-monospace,Menlo,Consolas,monospace";
const PULSE_KEYFRAMES = '@keyframes gcpulse{0%,100%{opacity:1}50%{opacity:.42}}';

/** Computed pill badge geometry — exported for width-math tests. */
export function pillWidths(text: string, hasSeal: boolean) {
  let x = PAD_X;
  const iconX = x;
  x += ICON_SIZE + GAP;
  const textX = x;
  x += text.length * CHAR_W;
  let sealX: number | null = null;
  if (hasSeal) {
    x += GAP;
    sealX = x;
    x += SEAL_SIZE;
  }
  return { iconX, textX, sealX, total: Math.round(x + PAD_X) };
}

export function pillBadge(props: BadgeProps): string {
  const { metric, label, state, theme, title } = props;
  const kind = state.kind;
  const meta = metricMeta(metric);

  const text =
    kind === 'collecting'
      ? 'collecting…'
      : kind === 'not-found'
        ? `${label} not found`
        : `${state.value} ${label}`;
  const sealKind: SealKind | null = kind === 'normal' ? 'check' : kind === 'stale' ? 'stale' : null;

  // Theme-varying roles; text color depends on state per the specimen ternaries.
  const roles: Record<string, { light: string; dark: string }> = {
    bg: PILL_COLORS.bg,
    border: PILL_COLORS.border,
    tx:
      kind === 'stale'
        ? PILL_COLORS.staleText
        : kind === 'not-found'
          ? PILL_COLORS.muted
          : PILL_COLORS.text,
    muted: PILL_COLORS.muted,
  };
  const { color, themeCss } = resolveColors(roles, theme);

  // Icon selection: status metrics render a green/amber dot; collecting and
  // not-found always render a muted dot (specimen ternaries verbatim).
  let iconName: MetricIcon = meta.icon;
  let iconColor = color['muted']!;
  if (meta.status && (kind === 'normal' || kind === 'stale')) {
    iconColor = state.value === '0' ? ACCENT_GREEN : AMBER;
  }
  if (kind === 'collecting' || kind === 'not-found') iconName = 'dot';
  const chip = kind === 'normal' || kind === 'stale' ? (state.langChip ?? null) : null;

  const { iconX, textX, sealX, total } = pillWidths(text, sealKind !== null);

  const pulse = kind === 'collecting';
  const css = `${pulse ? PULSE_KEYFRAMES : ''}${themeCss}`;
  const styleEl = css ? `<style>${css}</style>` : '';
  const rootStyle = `display:block${pulse ? ';animation:gcpulse 1.4s ease-in-out infinite' : ''}`;

  const seal =
    sealKind && sealX !== null
      ? sealSvg({
          size: SEAL_SIZE,
          kind: sealKind,
          color: ACCENT_GREEN,
          x: sealX,
          y: (H - SEAL_SIZE) / 2,
        })
      : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${H}" viewBox="0 0 ${total} ${H}" role="img" aria-label="${escapeXml(title)}" style="${rootStyle}">` +
    `<title>${escapeXml(title)}</title>` +
    styleEl +
    `<rect x="0.75" y="0.75" width="${total - 1.5}" height="${H - 1.5}" rx="${RX - 0.5}" fill="${color['bg']}" stroke="${color['border']}" stroke-width="1.5"/>` +
    icon(iconName, ICON_SIZE, iconColor, iconX, (H - ICON_SIZE) / 2, chip) +
    `<text x="${textX}" y="${H / 2 + 4}" fill="${color['tx']}" font-family="${MONO}" font-size="${FONT_SIZE}" letter-spacing="-0.2px">${escapeXml(text)}</text>` +
    seal +
    '</svg>'
  );
}

/** Metric glyphs, ported from the specimen `icon()` (24-unit viewBox). */
function icon(
  name: MetricIcon,
  size: number,
  color: string,
  x: number,
  y: number,
  chip: string | null,
): string {
  const open = `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 24 24" style="overflow:visible">`;
  const dr = `fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
  switch (name) {
    case 'branch':
      return (
        open +
        `<line x1="6" y1="3" x2="6" y2="15" ${dr}/>` +
        `<circle cx="6" cy="18" r="3" ${dr}/>` +
        `<circle cx="18" cy="6" r="3" ${dr}/>` +
        `<path d="M18 9a9 9 0 0 1-9 9" ${dr}/>` +
        '</svg>'
      );
    case 'clock':
      return (
        open +
        `<circle cx="12" cy="12" r="10" ${dr}/>` +
        `<line x1="12" y1="12" x2="12" y2="6" stroke="${color}" stroke-width="2" stroke-linecap="round"/>` +
        `<line x1="12" y1="12" x2="16" y2="12" stroke="${color}" stroke-width="2" stroke-linecap="round"/>` +
        '</svg>'
      );
    case 'dot':
      return `${open}<circle cx="12" cy="12" r="5.6" fill="${color}"/></svg>`;
    case 'lang':
      return `${open}<rect x="5" y="5" width="14" height="14" rx="3" fill="${chip ?? color}"/></svg>`;
    case 'calendar':
      return (
        open +
        `<rect x="3" y="4" width="18" height="18" rx="2" ${dr}/>` +
        `<line x1="16" y1="2" x2="16" y2="6" ${dr}/>` +
        `<line x1="8" y1="2" x2="8" y2="6" ${dr}/>` +
        `<line x1="3" y1="10" x2="21" y2="10" ${dr}/>` +
        '</svg>'
      );
    case 'square':
      return `${open}<rect x="6" y="6" width="12" height="12" rx="1.5" fill="${color}"/></svg>`;
  }
}
