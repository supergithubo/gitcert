import { describe, expect, it } from 'vitest';
import { sealSvg } from '../../src/badges/seal';

describe('sealSvg', () => {
  it('renders the check variant with circle and check path at stroke 2', () => {
    const svg = sealSvg({ size: 13, kind: 'check', color: '#ffffff' });
    expect(svg).toContain('<circle cx="12" cy="12" r="10"');
    expect(svg).toContain('stroke-width="2"');
    // The check path carries the page-side hover-draw hook (app.css gcdraw).
    // Emitted here so the seal stays the single canonical draw site.
    expect(svg).toContain('<path data-seal-check="" d="m9 12 2 2 4-4"');
    expect(svg).toContain('viewBox="0 0 24 24"');
  });

  it('renders data-seal-check as a VALUED attribute so badge SVGs stay well-formed XML', () => {
    // The seal is embedded in badge SVGs served as image/svg+xml and parsed
    // as strict XML, where a valueless attribute (`<path data-seal-check ...>`)
    // is a well-formedness error that makes the whole badge unrenderable in an
    // <img>. It MUST carry `=""` (regression guard for the v0.6.2 broken-badge
    // bug). The empty value still matches the `[data-seal-check]` hover selector.
    const svg = sealSvg({ size: 13, kind: 'check', color: '#ffffff' });
    expect(svg).toContain('data-seal-check=""');
    expect(svg).not.toMatch(/data-seal-check(?!="")/);
  });

  it('puts data-seal-check on the check path only — never on the circle or the stale seal', () => {
    const check = sealSvg({ size: 20, kind: 'check', color: 'var(--accent)' });
    expect(check.split('data-seal-check').length - 1).toBe(1);
    expect(check.slice(check.indexOf('<circle'), check.indexOf('<path'))).not.toContain(
      'data-seal-check',
    );
    expect(sealSvg({ size: 20, kind: 'stale', color: 'var(--faint)' })).not.toContain(
      'data-seal-check',
    );
  });

  it('renders the stale variant as a hollow circle only, stroke 1.5', () => {
    const svg = sealSvg({ size: 13, kind: 'stale', color: '#d6dcd5' });
    expect(svg).toContain('stroke-width="1.5"');
    expect(svg).not.toContain('<path');
  });

  it('positions as an inner svg with overflow visible when x/y given', () => {
    const svg = sealSvg({ size: 13, kind: 'check', color: '#ffffff', x: 100, y: 3.5 });
    expect(svg).toContain('x="100"');
    expect(svg).toContain('y="3.5"');
    expect(svg).toContain('style="overflow:visible"');
  });

  it('renders standalone as a block element for page use', () => {
    const svg = sealSvg({ size: 26, kind: 'check', color: 'var(--accent)' });
    expect(svg).toContain('width="26" height="26"');
    expect(svg).toContain('style="display:block"');
    expect(svg).not.toContain(' x=');
  });

  it('keeps the 24-unit viewBox at any size so the mark survives 12px', () => {
    const svg = sealSvg({ size: 12, kind: 'check', color: '#ffffff' });
    expect(svg).toContain('width="12" height="12" viewBox="0 0 24 24"');
  });
});
