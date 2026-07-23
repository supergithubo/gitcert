import { describe, expect, it } from 'vitest';
import {
  BADGE_PATH_TEMPLATE,
  SNIPPET_TEMPLATES,
  VERIFY_PATH_TEMPLATE,
  buildSnippets,
  fillSnippetTemplate,
  type SnippetParams,
} from '../../src/pages/snippets';

function params(overrides: Partial<SnippetParams> = {}): SnippetParams {
  return {
    owner: 'wnston',
    repo: 'client-platform',
    metric: 'commits',
    label: 'commits',
    style: 'flat',
    theme: 'auto',
    ...overrides,
  };
}

describe('buildSnippets — exact contract strings (spec §Copy-snippet contract)', () => {
  it('builds the exact md snippet with explicit style/theme params at defaults', () => {
    expect(buildSnippets(params()).md).toBe(
      '[![commits](https://gitcert.harborstack.app/b/wnston/client-platform/commits.svg?style=flat&theme=auto)](https://gitcert.harborstack.app/verify/wnston/client-platform)',
    );
  });

  it('builds the exact html snippet with the brief’s literal layout', () => {
    expect(buildSnippets(params()).html).toBe(
      '<a href="https://gitcert.harborstack.app/verify/wnston/client-platform">\n' +
        '  <img src="https://gitcert.harborstack.app/b/wnston/client-platform/commits.svg?style=flat&theme=auto"\n' +
        '       alt="commits — attested by GitCert" />\n' +
        '</a>',
    );
  });

  it('builds the exact react (plain JSX) snippet', () => {
    expect(buildSnippets(params()).react).toBe(
      '<a href="https://gitcert.harborstack.app/verify/wnston/client-platform">\n' +
        '  <img\n' +
        '    src="https://gitcert.harborstack.app/b/wnston/client-platform/commits.svg?style=flat&theme=auto"\n' +
        '    alt="commits — attested by GitCert"\n' +
        '  />\n' +
        '</a>',
    );
  });

  it('uses the human label in md alt brackets and alt=, slug only in URLs (issues → "open issues")', () => {
    const snips = buildSnippets(
      params({ metric: 'issues', label: 'open issues', style: 'pill', theme: 'dark' }),
    );
    expect(snips.md).toBe(
      '[![open issues](https://gitcert.harborstack.app/b/wnston/client-platform/issues.svg?style=pill&theme=dark)](https://gitcert.harborstack.app/verify/wnston/client-platform)',
    );
    expect(snips.html).toContain('alt="open issues — attested by GitCert"');
    expect(snips.html).toContain('/issues.svg?style=pill&theme=dark');
    expect(snips.react).toContain('alt="open issues — attested by GitCert"');
    expect(snips.react).not.toContain('open issues.svg');
  });

  it('never includes live numbers in alt text', () => {
    const snips = buildSnippets(params({ metric: 'last-commit', label: 'last commit' }));
    expect(snips.html).toContain('alt="last commit — attested by GitCert"');
    expect(snips.md).toContain('[![last commit]');
  });
});

describe('placeholder templates (dashboard state block source)', () => {
  it('keeps templates and concrete builders in lockstep', () => {
    const p = params({ metric: 'size', label: 'size', style: 'pill', theme: 'light' });
    const snips = buildSnippets(p);
    expect(fillSnippetTemplate(SNIPPET_TEMPLATES.md, p)).toBe(snips.md);
    expect(fillSnippetTemplate(SNIPPET_TEMPLATES.html, p)).toBe(snips.html);
    expect(fillSnippetTemplate(SNIPPET_TEMPLATES.react, p)).toBe(snips.react);
  });

  it('exposes relative badge/verify path templates for the preview img', () => {
    expect(BADGE_PATH_TEMPLATE).toBe('/b/{OWNER}/{REPO}/{METRIC}.svg?style={STYLE}&theme={THEME}');
    expect(VERIFY_PATH_TEMPLATE).toBe('/verify/{OWNER}/{REPO}');
    expect(
      fillSnippetTemplate(BADGE_PATH_TEMPLATE, params({ metric: 'open-prs', label: 'open PRs' })),
    ).toBe('/b/wnston/client-platform/open-prs.svg?style=flat&theme=auto');
  });

  it('leaves unknown brace tokens untouched (dumb substitution only)', () => {
    expect(fillSnippetTemplate('x {OWNER} {NOPE} y', params())).toBe('x wnston {NOPE} y');
  });
});
