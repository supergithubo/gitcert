import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppJwt, mintInstallationToken } from '../../src/collector/github';

// Synthetic 2048-bit RSA test key (PKCS#8), generated locally for tests only.
const TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC0MIExzhvns0K7
OKvVImVSHv6xcBA2U/+Tw1Auxq9aru9m7XrPvw1UfZnTTYE4NY4eCwmy8vjtAIoc
iVx3zrxTzvePK+A8WUhN86Al8hWiNKWVW3YCmW7J4V3CWrD6bVDde5QQGUe3gHeV
M7p64kBJlZUzb3H9MiS4FIjt1REj8NwyMr+3WOdmSZW9hFJ8chfjt+yMLHAZTyXG
gEfn80UotneTGXL6dRAD2gMOnhrHda+ESKqeI1ZfMFUHPg6s3dWTn0oMWIZjmm5H
xeD5jq9KD4zLDe5TyVE7RBlz0hD0jRQ/ESLAZgh/ZEUPtCI2T/LRmF+7doAWw1o9
gpSTnd4bAgMBAAECggEAAzKVKFgbAKqatY3U5sxcde+c33M4pm4pK+scYigedoKC
NxZhxowCZYxxDWHjuCajJf9WJbnQFwyaZtU9MdcWWnpixESoDwoakV+QaPv5zE4Y
3iSoXHVylNyN+GP5nggQlk2aHAsGzcfW12v6lDGtqGCiLC5/HFomcqnSoD3WtweI
j36cLbGI53PeYBWYpBc2RHZKZN0oHHAnN8+w8gqmEDAaxLUdKRkbjX+lt5d9k1/Y
lGV3FTbN7U8SQEOr4PB2BbBf/PnC5HL9Dgvf6dfGsqwoUHmzYrPCTobYX5dU3V5f
qhHk2uggZn5MJYigPfxnYpYfh7YxGyTez030LqD5oQKBgQDgaSE3GMky/Wp9T8o8
ERaWISDuKTMCwlMAz5VnNwBsm8Zm4QvUMhg3fllfAa7V0asB22j9tIUra+ZmEj57
7cs74FqvHwzbG3bnl6aRG9WAu1XF66z9bqrc/9WVIIoUH8H3rRCIMLH7bBerTdf/
/VdTuZomVdQqSExIE3eVXF5VsQKBgQDNjdGM9HiuP8JMKtEKYbRbT5Br+PmnGbu5
jbhNtakVHp7ZtPDQQ1nXSZXx66aXwU9rylJ5COZWEapxah6UJx1lDviDvLRBW4kc
XLZSyjNzIuYGIMBIomQClk7Xb00rkBA43kLgYiR3CXXXpfRlcdcU3DqC9Bz7e7R+
pSRsfMWHiwKBgHV1sYQEPjOpPxbuL513GEpmdrUR7XhRPF7dSIco29j9REDPJIDh
45kQUjkPSXLzdr3XGUJKPbX3mTXt8LSvR8REb1LgPrtkybz4vJ+RYRQref7Jl9dj
GJ3qbuHKkVttL/qypEeUrWQ7NLxeV2PPN+lD6bKNFCs5gmvrfJk6KspRAoGBAI6X
vfFROlJuioO6BA92nd3mAOLV8aHYuSBMTrkhtuyetEWEPrXKsw0kz+7lsUh+4nB9
Bt9NrDOyx5Ers5DE3aBYVU9V3ZmlPSU+r4AZIr3RTM6dc6YveL9Os9zBKkB5DLfW
f4AWtQMavfPd/P9OjIy9BZ4IZ/6Q3zInr2/O0lxnAoGBAN+6zhMPjFnLVf3j3XS/
JqHWHK87efqRJx6BUJk/uDW52csLbbTFvmNpLZSJnkzG6gHF86FR8Pih032armhg
B+8OwSyAY0WprJxF/TfqkDqkzQlyY5X26EhR36vVc71xNvq8FzWLlOf14L3vVBJc
XjclYFaaTFUAkHiIV49CY9Ub
-----END PRIVATE KEY-----`;

function decodeJwtPart(part: string): Record<string, unknown> {
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(base64));
}

describe('createAppJwt', () => {
  it('mints an RS256 JWT with iss/iat/exp matching a 10-minute window (happy path)', async () => {
    const fixedNow = new Date('2026-07-22T12:00:00Z');
    const jwt = await createAppJwt('app-123', TEST_PRIVATE_KEY, () => fixedNow);
    const parts = jwt.split('.');
    expect(parts).toHaveLength(3);
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
    const header = decodeJwtPart(headerPart);
    const payload = decodeJwtPart(payloadPart);

    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(payload.iss).toBe('app-123');
    const nowSeconds = Math.floor(fixedNow.getTime() / 1000);
    expect(payload.iat).toBe(nowSeconds - 60);
    expect(payload.exp).toBe(nowSeconds + 600);
    expect(signaturePart.length).toBeGreaterThan(0);
  });
});

describe('mintInstallationToken', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the token and expiry on a 200 response (happy path)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ token: 'ghs_abc', expires_at: '2026-07-22T13:00:00Z' }, { status: 201 }),
      ),
    );
    const result = await mintInstallationToken(
      'app-123',
      TEST_PRIVATE_KEY,
      5001,
      () => new Date('2026-07-22T12:00:00Z'),
    );
    expect(result).toEqual({ token: 'ghs_abc', expiresAt: '2026-07-22T13:00:00Z' });
  });

  it('returns null (never throws) on a non-200 response (error path)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('forbidden', { status: 403 })),
    );
    const result = await mintInstallationToken(
      'app-123',
      TEST_PRIVATE_KEY,
      5001,
      () => new Date('2026-07-22T12:00:00Z'),
    );
    expect(result).toBeNull();
  });

  it('sends an explicit User-Agent header', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ token: 't', expires_at: 'x' }, { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await mintInstallationToken('app-123', TEST_PRIVATE_KEY, 5001, () => new Date());
    expect(fetchMock.mock.calls).toHaveLength(1);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('expected fetch to have been called');
    const headers = call[1]?.headers as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/gitcert/);
  });
});
