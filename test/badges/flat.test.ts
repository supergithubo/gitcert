import { describe, expect, it } from 'vitest';
import { flatBadge, flatWidths } from '../../src/badges/flat';
import { renderBadge } from '../../src/badges/render';
import { ALL_METRICS, badgeProps, geometrySignature } from './helpers';

const STATES = ['normal', 'collecting', 'stale', 'not-found'] as const;

describe('flatBadge', () => {
  it('renders deterministic output for all 8 metrics × 4 states (light)', () => {
    for (const metric of ALL_METRICS) {
      for (const state of STATES) {
        const svg = flatBadge(badgeProps(metric, state, 'flat', 'light'));
        expect(svg).toMatchSnapshot(`flat ${metric} ${state} light`);
      }
    }
  });

  it('renders representative dark and auto variants', () => {
    for (const state of STATES) {
      expect(flatBadge(badgeProps('commits', state, 'flat', 'dark'))).toMatchSnapshot(
        `flat commits ${state} dark`,
      );
      expect(flatBadge(badgeProps('commits', state, 'flat', 'auto'))).toMatchSnapshot(
        `flat commits ${state} auto`,
      );
    }
  });

  it('computes width from the specimen formula (cw=6.55, padX=6)', () => {
    const props = badgeProps('commits', 'normal', 'flat', 'light');
    const svg = flatBadge(props);
    const { labelW, valueW, total } = flatWidths(props.label, '1,247', true);
    expect(labelW).toBe(Math.round(6 + 'commits'.length * 6.55 + 6));
    expect(valueW).toBe(Math.round(6 + '1,247'.length * 6.55 + 5 + 13 + 6));
    expect(svg).toContain(`width="${total}" height="20" viewBox="0 0 ${total} 20"`);
  });

  it('drops seal width for sealless states', () => {
    const { valueW } = flatWidths('commits', 'not found', false);
    expect(valueW).toBe(Math.round(6 + 'not found'.length * 6.55 + 6));
  });

  it('keeps geometry identical across light, dark, and auto themes', () => {
    for (const state of STATES) {
      const light = geometrySignature(flatBadge(badgeProps('issues', state, 'flat', 'light')));
      const dark = geometrySignature(flatBadge(badgeProps('issues', state, 'flat', 'dark')));
      const auto = geometrySignature(flatBadge(badgeProps('issues', state, 'flat', 'auto')));
      expect(dark).toEqual(light);
      expect(auto).toEqual(light);
    }
  });

  it('embeds the pulse animation only in the collecting state', () => {
    expect(flatBadge(badgeProps('commits', 'collecting', 'flat', 'light'))).toContain('gcpulse');
    for (const state of ['normal', 'stale', 'not-found'] as const) {
      expect(flatBadge(badgeProps('commits', state, 'flat', 'light'))).not.toContain('gcpulse');
    }
  });

  it('embeds both color tables behind prefers-color-scheme for auto only', () => {
    const auto = flatBadge(badgeProps('commits', 'normal', 'flat', 'auto'));
    expect(auto).toContain('@media(prefers-color-scheme:dark)');
    expect(auto).toContain('var(--gc-labelBg)');
    const light = flatBadge(badgeProps('commits', 'normal', 'flat', 'light'));
    expect(light).not.toContain('prefers-color-scheme');
    expect(light).not.toContain('var(');
  });

  it('renders the stale seal hollow (stroke 1.5, no check path)', () => {
    const svg = flatBadge(badgeProps('commits', 'stale', 'flat', 'light'));
    expect(svg).toContain('stroke-width="1.5"');
    expect(svg).not.toContain('m9 12 2 2 4-4');
  });

  it('escapes label overrides and titles', () => {
    const props = badgeProps('commits', 'normal', 'flat', 'light', `<script>&"'`);
    props.title = 'a/b: <img> & "quotes"';
    const svg = flatBadge(props);
    expect(svg).not.toContain('<script>');
    expect(svg).not.toContain('<img>');
    expect(svg).toContain('&lt;script&gt;&amp;&quot;&apos;');
  });

  it('renders an accessible title and role on every state', () => {
    for (const state of STATES) {
      const svg = flatBadge(badgeProps('commits', state, 'flat', 'light'));
      expect(svg).toContain('role="img"');
      expect(svg).toMatch(/<title>wnston\/client-platform: .+ \(attested by gitcert\)<\/title>/);
    }
  });

  // Multi-badge-in-one-document class: a fixed clip id resolves document-wide
  // to the FIRST badge's clipPath when several flat badges are inlined in one
  // page, truncating every subsequent badge (shipped as a live landing defect).
  describe('clip ids across one document', () => {
    it('gives distinct badges unique clipPath ids in combined markup', () => {
      const badges = [
        flatBadge(badgeProps('commits', 'normal', 'flat', 'auto')),
        flatBadge(badgeProps('last-commit', 'normal', 'flat', 'auto')),
        flatBadge(badgeProps('first-commit', 'normal', 'flat', 'auto')),
        flatBadge(badgeProps('language', 'normal', 'flat', 'auto')),
      ];
      const document = badges.join('');
      const ids = [...document.matchAll(/<clipPath id="([^"]+)"/g)].map((m) => m[1]);
      expect(ids).toHaveLength(badges.length);
      expect(new Set(ids).size).toBe(badges.length);
    });

    it('references each badge clip by its own id', () => {
      for (const metric of ALL_METRICS) {
        const svg = flatBadge(badgeProps(metric, 'normal', 'flat', 'light'));
        const id = /<clipPath id="([^"]+)"/.exec(svg)?.[1];
        expect(id).toBeTruthy();
        expect(svg).toContain(`clip-path="url(#${id})"`);
      }
    });

    it('derives the id deterministically from props (same props → same bytes)', () => {
      const props = badgeProps('commits', 'normal', 'flat', 'auto');
      expect(flatBadge(props)).toBe(flatBadge(badgeProps('commits', 'normal', 'flat', 'auto')));
    });
  });

  it('dispatches through renderBadge', () => {
    const props = badgeProps('commits', 'normal', 'flat', 'light');
    expect(renderBadge(props)).toBe(flatBadge(props));
  });
});
