import { describe, expect, it } from 'vitest';
import { pillBadge, pillWidths } from '../../src/badges/pill';
import { renderBadge } from '../../src/badges/render';
import { ACCENT_GREEN, AMBER } from '../../src/badges/theme';
import { ALL_METRICS, badgeProps, geometrySignature } from './helpers';

const STATES = ['normal', 'collecting', 'stale', 'not-found'] as const;

describe('pillBadge', () => {
  it('renders deterministic output for all 8 metrics × 4 states (light)', () => {
    for (const metric of ALL_METRICS) {
      for (const state of STATES) {
        const svg = pillBadge(badgeProps(metric, state, 'pill', 'light'));
        expect(svg).toMatchSnapshot(`pill ${metric} ${state} light`);
      }
    }
  });

  it('renders representative dark and auto variants', () => {
    for (const state of STATES) {
      expect(pillBadge(badgeProps('language', state, 'pill', 'dark'))).toMatchSnapshot(
        `pill language ${state} dark`,
      );
      expect(pillBadge(badgeProps('language', state, 'pill', 'auto'))).toMatchSnapshot(
        `pill language ${state} auto`,
      );
    }
  });

  it('computes width from the specimen formula (cw=6.9, padX=11, gap=6)', () => {
    const props = badgeProps('commits', 'normal', 'pill', 'light');
    const svg = pillBadge(props);
    const text = '1,247 commits';
    const { iconX, textX, sealX, total } = pillWidths(text, true);
    expect(iconX).toBe(11);
    expect(textX).toBe(11 + 13 + 6);
    expect(sealX).toBe(textX + text.length * 6.9 + 6);
    expect(total).toBe(Math.round(sealX! + 13 + 11));
    expect(svg).toContain(`width="${total}" height="24" viewBox="0 0 ${total} 24"`);
  });

  it('drops seal width for sealless states', () => {
    const withSeal = pillWidths('x', true).total;
    const without = pillWidths('x', false).total;
    expect(withSeal - without).toBe(6 + 13);
  });

  it('keeps geometry identical across light, dark, and auto themes', () => {
    for (const state of STATES) {
      const light = geometrySignature(pillBadge(badgeProps('size', state, 'pill', 'light')));
      const dark = geometrySignature(pillBadge(badgeProps('size', state, 'pill', 'dark')));
      const auto = geometrySignature(pillBadge(badgeProps('size', state, 'pill', 'auto')));
      expect(dark).toEqual(light);
      expect(auto).toEqual(light);
    }
  });

  it('colors the status dot green at zero and amber above zero', () => {
    // open-prs fixture value is 0 → green; issues fixture value is 3 → amber.
    expect(pillBadge(badgeProps('open-prs', 'normal', 'pill', 'light'))).toContain(
      `<circle cx="12" cy="12" r="5.6" fill="${ACCENT_GREEN}"/>`,
    );
    expect(pillBadge(badgeProps('issues', 'normal', 'pill', 'light'))).toContain(
      `<circle cx="12" cy="12" r="5.6" fill="${AMBER}"/>`,
    );
  });

  it('renders the language chip with the linguist color', () => {
    expect(pillBadge(badgeProps('language', 'normal', 'pill', 'light'))).toContain(
      '<rect x="5" y="5" width="14" height="14" rx="3" fill="#3178c6"/>',
    );
  });

  it('renders a muted dot instead of the metric icon for collecting and not-found', () => {
    for (const state of ['collecting', 'not-found'] as const) {
      const svg = pillBadge(badgeProps('language', state, 'pill', 'light'));
      expect(svg).toContain('r="5.6"');
      expect(svg).not.toContain('#3178c6');
    }
  });

  it('embeds the pulse animation only in the collecting state', () => {
    expect(pillBadge(badgeProps('commits', 'collecting', 'pill', 'light'))).toContain('gcpulse');
    for (const state of ['normal', 'stale', 'not-found'] as const) {
      expect(pillBadge(badgeProps('commits', state, 'pill', 'light'))).not.toContain('gcpulse');
    }
  });

  it('renders the stale seal hollow and the not-found text cause-blind', () => {
    const stale = pillBadge(badgeProps('commits', 'stale', 'pill', 'light'));
    expect(stale).toContain('stroke-width="1.5"');
    expect(stale).not.toContain('m9 12 2 2 4-4');
    const notFound = pillBadge(badgeProps('commits', 'not-found', 'pill', 'light'));
    expect(notFound).toContain('commits not found');
  });

  it('escapes label overrides and titles', () => {
    const props = badgeProps('commits', 'normal', 'pill', 'light', `<b>&"'`);
    const svg = pillBadge(props);
    expect(svg).not.toContain('<b>');
    expect(svg).toContain('&lt;b&gt;&amp;&quot;&apos;');
  });

  it('dispatches through renderBadge', () => {
    const props = badgeProps('commits', 'normal', 'pill', 'light');
    expect(renderBadge(props)).toBe(pillBadge(props));
  });
});
