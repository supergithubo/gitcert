/**
 * The single canonical GitCert seal mark (svg-badges rules: drawn here and
 * nowhere else). Ported verbatim from the specimen `seal()` component in
 * `artifacts/design/badges.dc.html` — circle r=10 plus check path, 24×24
 * viewBox. The dead `revoked` branch was not ported (design decision #10).
 */

export type SealKind = 'check' | 'stale';

export interface SealOptions {
  /** Rendered size in px (viewBox stays 0 0 24 24 — survives 12px). */
  size: number;
  /** `check` = full seal; `stale` = hollow circle, thinner stroke, no check. */
  kind: SealKind;
  /** Stroke color — a literal or a CSS `var(...)` reference. Callers pass trusted constants only. */
  color: string;
  /** Optional position for embedding as an inner `<svg>` inside a badge. */
  x?: number;
  y?: number;
}

/** Renders the canonical seal as a self-contained `<svg>` string. */
export function sealSvg(options: SealOptions): string {
  const { size, kind, color, x, y } = options;
  const positioned = x !== undefined && y !== undefined;
  const position = positioned ? ` x="${x}" y="${y}"` : '';
  // Embedded in a badge: overflow past the inner viewport like the specimen.
  // Standalone on a page: block-level like the mock's header/nav seals.
  const style = positioned ? 'overflow:visible' : 'display:block';
  const stroke = `fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round"`;
  const circle = `<circle cx="12" cy="12" r="10" ${stroke} stroke-width="${kind === 'stale' ? '1.5' : '2'}"/>`;
  // `data-seal-check` is the page-side hover-draw hook (app.css `gcdraw`).
  // Emitted here because this is the ONE place the seal is drawn — never at
  // call sites. It MUST carry an explicit `=""` value: the seal is also
  // embedded in badge SVGs served as `image/svg+xml` and parsed as strict
  // XML, where a valueless attribute is a well-formedness error that makes
  // the whole badge unrenderable. Inert inside a badge (no `gcdraw` keyframe
  // in the badge's own <style>); the empty value keeps the hover selector
  // `[data-seal-check]` matching on HTML pages.
  const check =
    kind === 'check'
      ? `<path data-seal-check="" d="m9 12 2 2 4-4" ${stroke} stroke-width="2"/>`
      : '';
  return `<svg${position} width="${size}" height="${size}" viewBox="0 0 24 24" style="${style}">${circle}${check}</svg>`;
}
