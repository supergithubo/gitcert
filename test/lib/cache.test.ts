import { describe, expect, it, vi } from 'vitest';
import {
  CACHE_CONTROL,
  buildEtag,
  edgeCache,
  matchesEtag,
  purgeBadgeUrls,
  withConditionalGet,
} from '../../src/lib/cache';

describe('buildEtag', () => {
  it('joins parts into a quoted strong ETag (happy path)', async () => {
    const etag = await buildEtag(['GC-000000', 'commits', 'flat', 'light']);
    expect(etag).toBe('"GC-000000:commits:flat:light"');
  });

  it('appends an 8-char label hash so a label override varies the ETag (edge case)', async () => {
    const withoutLabel = await buildEtag(['GC-000000', 'commits', 'flat', 'light']);
    const withLabel = await buildEtag(['GC-000000', 'commits', 'flat', 'light'], 'custom label');
    expect(withLabel).not.toBe(withoutLabel);
    expect(withLabel).toMatch(/^"GC-000000:commits:flat:light:[0-9a-f]{8}"$/);
  });

  it('is deterministic for the same label', async () => {
    const first = await buildEtag(['GC-000000'], 'same label');
    const second = await buildEtag(['GC-000000'], 'same label');
    expect(first).toBe(second);
  });
});

describe('matchesEtag', () => {
  it('matches an exact single ETag (happy path)', () => {
    expect(matchesEtag('"abc"', '"abc"')).toBe(true);
  });

  it('matches within a comma-separated list', () => {
    expect(matchesEtag('"one", "abc", "two"', '"abc"')).toBe(true);
  });

  it('matches the wildcard', () => {
    expect(matchesEtag('*', '"abc"')).toBe(true);
  });

  it('returns false for no header (error path)', () => {
    expect(matchesEtag(null, '"abc"')).toBe(false);
  });

  it('returns false when the header does not contain the ETag (edge case)', () => {
    expect(matchesEtag('"other"', '"abc"')).toBe(false);
  });
});

describe('withConditionalGet', () => {
  it('downgrades to a bodyless 304 carrying only ETag/Cache-Control/CORS on a match (happy path)', () => {
    const request = new Request('https://example.com/b/o/r/commits.svg', {
      headers: { 'If-None-Match': '"abc"' },
    });
    const response = new Response('<svg></svg>', {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml',
        ETag: '"abc"',
        'Cache-Control': CACHE_CONTROL.normal,
        'Access-Control-Allow-Origin': '*',
      },
    });
    const result = withConditionalGet(request, response);
    expect(result.status).toBe(304);
    expect(result.headers.get('ETag')).toBe('"abc"');
    expect(result.headers.get('Cache-Control')).toBe(CACHE_CONTROL.normal);
    expect(result.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(result.headers.get('Content-Type')).toBeNull();
  });

  it('passes the response through unchanged when If-None-Match does not match (error path)', async () => {
    const request = new Request('https://example.com/b/o/r/commits.svg', {
      headers: { 'If-None-Match': '"other"' },
    });
    const response = new Response('<svg></svg>', {
      status: 200,
      headers: { ETag: '"abc"' },
    });
    const result = withConditionalGet(request, response);
    expect(result.status).toBe(200);
    await expect(result.text()).resolves.toBe('<svg></svg>');
  });

  it('passes the response through unchanged when it carries no ETag (edge case: collecting/not-found)', () => {
    const request = new Request('https://example.com/b/o/r/commits.svg', {
      headers: { 'If-None-Match': '"abc"' },
    });
    const response = new Response('<svg></svg>', { status: 200 });
    const result = withConditionalGet(request, response);
    expect(result.status).toBe(200);
  });
});

describe('edgeCache', () => {
  it('runs the handler and stores the response on a miss (happy path)', async () => {
    const request = new Request(`https://example.com/edge-cache-test/${crypto.randomUUID()}`);
    const waitUntil = vi.fn((promise: Promise<unknown>) => promise);
    const handler = vi.fn(
      async () => new Response('hit', { headers: { 'Cache-Control': CACHE_CONTROL.normal } }),
    );

    const response = await edgeCache(request, { waitUntil }, handler);

    expect(handler).toHaveBeenCalledOnce();
    expect(waitUntil).toHaveBeenCalledOnce();
    await expect(response.text()).resolves.toBe('hit');
  });

  it('returns the cached response without calling the handler again on a hit', async () => {
    const request = new Request(`https://example.com/edge-cache-test/${crypto.randomUUID()}`);
    let stored: Promise<unknown> = Promise.resolve();
    const handlerFirst = vi.fn(
      async () => new Response('first', { headers: { 'Cache-Control': CACHE_CONTROL.normal } }),
    );
    await edgeCache(
      request,
      {
        waitUntil: (p) => {
          stored = p;
        },
      },
      handlerFirst,
    );
    // Real `ExecutionContext.waitUntil` guarantees the promise settles before
    // the response is considered complete — await it explicitly here since
    // this fake doesn't block on it itself.
    await stored;

    const handlerSecond = vi.fn(
      async () => new Response('second', { headers: { 'Cache-Control': CACHE_CONTROL.normal } }),
    );
    const response = await edgeCache(request, { waitUntil: (p) => p }, handlerSecond);

    expect(handlerSecond).not.toHaveBeenCalled();
    await expect(response.text()).resolves.toBe('first');
  });

  it('does not store a no-store response (edge case: /healthz-style bypass)', async () => {
    const request = new Request(`https://example.com/edge-cache-test/${crypto.randomUUID()}`);
    const waitUntil = vi.fn((promise: Promise<unknown>) => promise);
    const handler = vi.fn(
      async () => new Response('nostore', { headers: { 'Cache-Control': 'no-store' } }),
    );

    await edgeCache(request, { waitUntil }, handler);
    expect(waitUntil).not.toHaveBeenCalled();

    const secondHandler = vi.fn(
      async () => new Response('again', { headers: { 'Cache-Control': 'no-store' } }),
    );
    const response = await edgeCache(request, { waitUntil }, secondHandler);
    expect(secondHandler).toHaveBeenCalledOnce();
    await expect(response.text()).resolves.toBe('again');
  });
});

describe('purgeBadgeUrls', () => {
  it('deletes every metric/style/theme variant plus the bare-default URL (happy path)', async () => {
    const owner = `purge-owner-${crypto.randomUUID()}`;
    const name = 'repo-a';
    const cache = caches.default;

    // Seed a representative sample of the canonical variant set, plus one
    // bare-default URL, so we can assert they're all gone afterward.
    const seeded = [
      `https://gitcert.harborstack.app/b/${owner}/${name}/commits.svg`,
      `https://gitcert.harborstack.app/b/${owner}/${name}/commits.svg?style=flat&theme=light`,
      `https://gitcert.harborstack.app/b/${owner}/${name}/size.svg?style=pill&theme=dark`,
      `https://gitcert.harborstack.app/b/${owner}/${name}/language.svg?style=pill&theme=auto`,
    ];
    for (const url of seeded) {
      await cache.put(
        url,
        new Response('<svg></svg>', { headers: { 'Cache-Control': 'public, max-age=300' } }),
      );
    }
    for (const url of seeded) {
      await expect(cache.match(url)).resolves.toBeDefined();
    }

    await purgeBadgeUrls({ owner, name });

    for (const url of seeded) {
      await expect(cache.match(url)).resolves.toBeUndefined();
    }
  });

  it('is a no-op (never throws) when nothing was cached for the repo (edge case)', async () => {
    await expect(
      purgeBadgeUrls({ owner: `never-cached-${crypto.randomUUID()}`, name: 'repo-b' }),
    ).resolves.toBeUndefined();
  });
});
