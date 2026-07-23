/**
 * Flat badge template — two-segment README default, ported verbatim from
 * the specimen `flatBadge()` in `artifacts/design/badges.dc.html`.
 * Geometry: H=20, fs=11, cw=6.55, padX=6, rx=3 clip; seal 13px, gap 5.
 * Pure function: props → deterministic SVG string.
 */

import { escapeXml } from './format';
import { sealSvg } from './seal';
import type { SealKind } from './seal';
import { FLAT_COLORS, resolveColors } from './theme';
import type { BadgeProps } from './types';

const H = 20;
const FONT_SIZE = 11;
const CHAR_W = 6.55;
const PAD_X = 6;
const SEAL_SIZE = 13;
const SEAL_GAP = 5;
const TEXT_Y = 14;
const MONO = "'SF Mono',ui-monospace,Menlo,Consolas,monospace";
const PULSE_KEYFRAMES = '@keyframes gcpulse{0%,100%{opacity:1}50%{opacity:.42}}';

/** Computed flat badge geometry — exported for width-math tests. */
export function flatWidths(label: string, valueText: string, hasSeal: boolean) {
  const labelW = Math.round(PAD_X + label.length * CHAR_W + PAD_X);
  const gap = hasSeal ? SEAL_GAP : 0;
  const sealSz = hasSeal ? SEAL_SIZE : 0;
  const valueW = Math.round(PAD_X + valueText.length * CHAR_W + gap + sealSz + PAD_X);
  return { labelW, valueW, total: labelW + valueW };
}

export function flatBadge(props: BadgeProps): string {
  const { label, state, theme, title } = props;
  const kind = state.kind;

  const valueText =
    kind === 'collecting' ? 'collecting…' : kind === 'not-found' ? 'not found' : state.value;
  const sealKind: SealKind | null = kind === 'normal' ? 'check' : kind === 'stale' ? 'stale' : null;

  const stateColors = FLAT_COLORS.value[kind];
  const roles: Record<string, { light: string; dark: string }> = {
    labelBg: FLAT_COLORS.labelBg,
    labelText: FLAT_COLORS.labelText,
    valueBg: stateColors.bg,
    valueText: stateColors.text,
  };
  if (sealKind && 'seal' in stateColors) roles['seal'] = stateColors.seal;
  const { color, themeCss } = resolveColors(roles, theme);

  const { labelW, valueW, total } = flatWidths(label, valueText, sealKind !== null);
  const textAttrs = `font-family="${MONO}" font-size="${FONT_SIZE}" letter-spacing="-0.2px"`;

  const pulse = kind === 'collecting';
  const css = `${pulse ? PULSE_KEYFRAMES : ''}${themeCss}`;
  const styleEl = css ? `<style>${css}</style>` : '';

  const seal = sealKind
    ? sealSvg({
        size: SEAL_SIZE,
        kind: sealKind,
        color: color['seal']!,
        x: labelW + PAD_X + valueText.length * CHAR_W + SEAL_GAP,
        y: (H - SEAL_SIZE) / 2,
      })
    : '';
  const valueGroup =
    `<g${pulse ? ' style="animation:gcpulse 1.4s ease-in-out infinite"' : ''}>` +
    `<rect x="${labelW}" y="0" width="${valueW}" height="${H}" fill="${color['valueBg']}"/>` +
    `<text x="${labelW + PAD_X}" y="${TEXT_Y}" fill="${color['valueText']}" ${textAttrs}>${escapeXml(valueText)}</text>` +
    seal +
    '</g>';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${H}" viewBox="0 0 ${total} ${H}" role="img" aria-label="${escapeXml(title)}" style="display:block">` +
    `<title>${escapeXml(title)}</title>` +
    styleEl +
    `<clipPath id="gcf"><rect width="${total}" height="${H}" rx="3"/></clipPath>` +
    `<g clip-path="url(#gcf)">` +
    `<rect x="0" y="0" width="${labelW}" height="${H}" fill="${color['labelBg']}"/>` +
    `<text x="${PAD_X}" y="${TEXT_Y}" fill="${color['labelText']}" ${textAttrs}>${escapeXml(label)}</text>` +
    valueGroup +
    '</g>' +
    '</svg>'
  );
}
