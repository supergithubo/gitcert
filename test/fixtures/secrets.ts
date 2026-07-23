/**
 * Synthetic, clearly-fake bindings for the test runtime. There is no
 * `.dev.vars` checked into the repo — provisioning real secrets for local
 * dev is a per-developer operator step (see `.dev.vars.example`), not
 * something the test suite should depend on. These constants make the full
 * suite self-sufficient without one.
 *
 * None of these are real credentials: the RSA keypair and Ed25519 seed were
 * generated solely for this test suite (never used outside it, never tied
 * to any real GitHub App or signing key).
 */

/** Matches the HMAC fixtures signed by `test/helpers/webhookSignature.ts`. */
export const TEST_GITHUB_WEBHOOK_SECRET = 'test-webhook-secret';

/** Synthetic Ed25519 signing seed (bytes 1..32, base64) — same fixture already used in test/lib/sign.test.ts. */
export const TEST_SIGNING_KEY = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=';

/** Fake numeric GitHub App id — never a real App. */
export const TEST_GITHUB_APP_ID = '999999';

/** Synthetic OAuth client id — never a real GitHub App. */
export const TEST_GITHUB_CLIENT_ID = 'test-client-id';

/** Synthetic OAuth client secret — never a real GitHub App. */
export const TEST_GITHUB_CLIENT_SECRET = 'test-client-secret';

/** Synthetic HMAC secret for the `gc_session` cookie — used only in tests. */
export const TEST_SESSION_SECRET = 'test-session-secret';

/**
 * Synthetic 2048-bit RSA keypair (PKCS8 PEM), generated once via
 * `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048` solely to
 * exercise `createAppJwt`'s RS256 signing path in tests.
 */
export const TEST_GITHUB_APP_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQC/gx5T6Zu+i+WM
njCqRBJjS3JcRDt0A33z45yXMKPZ5LtGutVrUNy8KJXOx6TKTGgs1cxajYD27GOW
Gi+54tRMz2DMEFBMuo9GjS4lykZ5x7bYvnE+tvFGws4XVgx0UDoKdrkxonyIqrR5
B/w+oNuq/YAkh988kNF5Kdu6+CF3Wcki3QIAo7xgGO03MaaSto9sFS0kPXUWVw48
72idDq3Cm4PD4Pg26bZ7d3/HR4GDk5JLZh0AxuuonokcCylIOOZMV2VwgzthfvV5
wJlUtfzDTjatnRqxrNucrOempjv5DWlsSOVRLoRdsdhIwt0YkCqfRDPTWLZFa2ls
SJRQZEe3AgMBAAECggEAAcKYaRhbjcEcEf0eNg0RcjIuUeTFUHKmb128gbM5E6FD
i18045tG/BUPaMAdppz/KXJUQid3c6Lb43RIKK2KBU6z9WGCVheHhj7OmXBQ0iu2
ECs9P+Ckj7bt9/ma0bLZuwuOS4N9INsYyjKlly8ZSxVbXnqVNamgaJGsQFKpfr74
xAlkn9IkiaTGGrHqob7o3tSxbJKzG3MH9h2sasTdf80I3ky6gzC/3R2KyU/aKLvq
cwwRRTFV63aFHxhT3aNTr4O3mULwawq+UMuKrH96G/wS5LiTSEn3TOBM86kfs899
nUXDTeyl8adFfAm0EwDoz+l7FZHy7FVVwFJtqLgoAQKBgQDoua4rASvKxGrjBgwy
erjqO+Yta7n8PrHt9hn9oX6BmFdkdPS+lb6B2d7axo/yq78e+lcvmFvxDNSA8ho0
NYm2M/YRK6pHlWpnhwUAncFvmPRIvQ4Xu3TzGjE6G1Aeh12G6x3G5zzfZ8mzmIPF
9c+UrOFjKSMPTWIOyMzV/jzMAQKBgQDSqkjEoaO1oVsgqP3JzoRBIw1QgIA1M6wt
P3ryX78X6AU4Ga8aWsnaujdbrdns8m6nCtpfxIewveMAQI84hexAmLRxLc9QLMXq
p9luetKTWCzJwlD1RwHSniMQlseUwluNLWwK2rwBxMwIpdMW1dTsTO5c5dbOYA4i
inkPS0pztwKBgB1oAOrsLfVkFkFzbS0ftqfaQ75vg0OtRFxWIXib5FlJv5kw8g/2
6eiMeA1a06uNKgwnA8c+0DdIML3OWaNJNIpyTGBlDRIYfiZwuCAYzu1j/VIHmXVE
OYXSRHAcLWZ+IkI/CTct1tI/0gvAdL4Zzk3x/lTCSOzREVfe5YsQoewBAoGAN8fA
9te56ljsMSyt7maRXFH0r5Em4W9qMpzxaAX0KldUMnOSis7pTdIq4EqbPoM+y1oz
UlJOf3z4A1QU2CmV0dDdTm6LyzXfve9twjQhV8RsL4wVNaz0jZkzvau+8uO3rB0P
05vxViKOx+doik5aT6tbHhv5kbGbbIfv4B3We+cCgYBiz57tP/1f1/goQ3oSQLCX
LVuLEYR2OS026OnX0RjmJBDt6+weAX49akw7j47vqRCLjIgyee5NF7p/Gynmufqj
u9OD+Kgc0rASg+fXK5bCUS9k1keFB5Tzt0cUFpfmMn9vHdmh5cmM/PmGsWacEYIf
jfh3K4hwYfMtVoSrbeAZTA==
-----END PRIVATE KEY-----`;
