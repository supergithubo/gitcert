import { SELF, env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installationCreatedPayload,
  installationDeletedPayload,
  installationRepositoriesAddedPayload,
  installationRepositoriesRemovedPayload,
  installationSuspendPayload,
  installationUnsuspendPayload,
  repositoryRenamedPayload,
} from '../fixtures/webhooks';
import { signWebhookBody } from '../helpers/webhookSignature';

const WEBHOOK_URL = 'https://gitcert.harborstack.app/webhooks/github';
const WEBHOOK_SECRET = 'test-webhook-secret'; // matches .dev.vars GITHUB_WEBHOOK_SECRET

async function postWebhook(event: string, payload: unknown, signature?: string) {
  const rawBody = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-github-event': event,
  };
  const sig = signature ?? (await signWebhookBody(rawBody, WEBHOOK_SECRET));
  headers['x-hub-signature-256'] = sig;
  return SELF.fetch(WEBHOOK_URL, { method: 'POST', headers, body: rawBody });
}

describe('POST /webhooks/github', () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM stats'),
      env.DB.prepare('DELETE FROM repos'),
      env.DB.prepare('DELETE FROM installations'),
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('installation created: upserts the installation + repos and enqueues a first collect (happy path)', async () => {
    // Stub the network boundary so the background collector (waitUntil) never hits real GitHub.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );

    const response = await postWebhook('installation', installationCreatedPayload());
    expect(response.status).toBe(200);

    const installation = await env.DB.prepare('SELECT * FROM installations WHERE id = ?1')
      .bind(5001)
      .first<{ account_login: string; suspended_at: string | null }>();
    expect(installation).toMatchObject({ account_login: 'wnston', suspended_at: null });

    const repos = await env.DB.prepare('SELECT id, owner, name FROM repos ORDER BY id').all<{
      id: number;
      owner: string;
      name: string;
    }>();
    expect(repos.results).toEqual([
      { id: 7001, owner: 'wnston', name: 'client-platform' },
      { id: 7002, owner: 'wnston', name: 'gitcert' },
    ]);
  });

  it('installation deleted: sets suspended_at', async () => {
    await postWebhook('installation', installationCreatedPayload());
    const response = await postWebhook('installation', installationDeletedPayload());
    expect(response.status).toBe(200);

    const row = await env.DB.prepare('SELECT suspended_at FROM installations WHERE id = ?1')
      .bind(5001)
      .first<{ suspended_at: string | null }>();
    expect(row?.suspended_at).not.toBeNull();
  });

  it('installation suspend then unsuspend toggles suspended_at', async () => {
    await postWebhook('installation', installationCreatedPayload());
    await postWebhook('installation', installationSuspendPayload());
    let row = await env.DB.prepare('SELECT suspended_at FROM installations WHERE id = ?1')
      .bind(5001)
      .first<{ suspended_at: string | null }>();
    expect(row?.suspended_at).not.toBeNull();

    await postWebhook('installation', installationUnsuspendPayload());
    row = await env.DB.prepare('SELECT suspended_at FROM installations WHERE id = ?1')
      .bind(5001)
      .first<{ suspended_at: string | null }>();
    expect(row?.suspended_at).toBeNull();
  });

  it('installation_repositories added: inserts the new repo', async () => {
    await postWebhook('installation', installationCreatedPayload());
    const response = await postWebhook(
      'installation_repositories',
      installationRepositoriesAddedPayload(),
    );
    expect(response.status).toBe(200);

    const row = await env.DB.prepare('SELECT owner, name FROM repos WHERE id = ?1')
      .bind(7003)
      .first<{ owner: string; name: string }>();
    expect(row).toEqual({ owner: 'wnston', name: 'new-repo' });
  });

  it('installation_repositories removed: sets removed_at without deleting the row (edge case)', async () => {
    await postWebhook('installation', installationCreatedPayload());
    const response = await postWebhook(
      'installation_repositories',
      installationRepositoriesRemovedPayload(),
    );
    expect(response.status).toBe(200);

    const row = await env.DB.prepare('SELECT id, removed_at FROM repos WHERE id = ?1')
      .bind(7001)
      .first<{ id: number; removed_at: string | null }>();
    expect(row?.id).toBe(7001);
    expect(row?.removed_at).not.toBeNull();
  });

  it('repository renamed: updates owner/name/private on the existing row', async () => {
    await postWebhook('installation', installationCreatedPayload());
    const response = await postWebhook('repository', repositoryRenamedPayload());
    expect(response.status).toBe(200);

    const row = await env.DB.prepare('SELECT name FROM repos WHERE id = ?1')
      .bind(7001)
      .first<{ name: string }>();
    expect(row?.name).toBe('client-platform-v2');
  });

  it('unknown event type is a 200 no-op', async () => {
    const response = await postWebhook('marketplace_purchase', { action: 'purchased' });
    expect(response.status).toBe(200);
  });

  it('rejects a missing signature with 401 and writes nothing to D1 (permission boundary)', async () => {
    const rawBody = JSON.stringify(installationCreatedPayload());
    const response = await SELF.fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-github-event': 'installation' },
      body: rawBody,
    });
    expect(response.status).toBe(401);

    const row = await env.DB.prepare('SELECT id FROM installations WHERE id = ?1')
      .bind(5001)
      .first();
    expect(row).toBeNull();
  });

  it('rejects a bad signature with 401 and writes nothing to D1 (permission boundary)', async () => {
    const response = await postWebhook(
      'installation',
      installationCreatedPayload(),
      'sha256=0000000000000000000000000000000000000000000000000000000000000',
    );
    expect(response.status).toBe(401);

    const row = await env.DB.prepare('SELECT id FROM installations WHERE id = ?1')
      .bind(5001)
      .first();
    expect(row).toBeNull();
  });

  it('rejects a malformed JSON body with 400 despite a valid signature (error path)', async () => {
    const rawBody = '{not valid json';
    const signature = await signWebhookBody(rawBody, WEBHOOK_SECRET);
    const response = await SELF.fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'installation',
        'x-hub-signature-256': signature,
      },
      body: rawBody,
    });
    expect(response.status).toBe(400);
  });
});
