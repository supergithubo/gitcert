import { Hono } from 'hono';
import type { Env } from '../env';
import {
  markRepoRemoved,
  suspendInstallation,
  unsuspendInstallation,
  updateRepo,
  upsertInstallation,
  upsertRepos,
  type RepoInput,
} from '../lib/db';
import { verifyGithubSignature } from '../lib/webhookSignature';
import { runCollector } from '../collector/run';

/**
 * `POST /webhooks/github` — GitHub App webhook receiver (SPEC.md §5, §13).
 * HMAC verified BEFORE any body parsing; unknown event types/actions are a
 * 200 no-op (GitHub retries on non-2xx). A thin controller: parse/validate
 * then delegate to `lib/db.ts`.
 */
export const webhooks = new Hono<{ Bindings: Env }>();

interface GithubAccount {
  id: number;
  login: string;
  type: string;
}

interface GithubInstallationRef {
  id: number;
  account: GithubAccount;
}

interface GithubRepoRef {
  id: number;
  fullName: string;
  private: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function splitFullName(fullName: string): { owner: string; name: string } {
  const separatorIndex = fullName.indexOf('/');
  return { owner: fullName.slice(0, separatorIndex), name: fullName.slice(separatorIndex + 1) };
}

function asInstallationRef(value: unknown): GithubInstallationRef | null {
  if (!isRecord(value) || typeof value.id !== 'number' || !isRecord(value.account)) return null;
  const { id: accountId, login, type } = value.account;
  if (typeof accountId !== 'number' || typeof login !== 'string' || typeof type !== 'string') {
    return null;
  }
  return { id: value.id, account: { id: accountId, login, type } };
}

function asRepoRefs(value: unknown): GithubRepoRef[] | null {
  if (!Array.isArray(value)) return null;
  const refs: GithubRepoRef[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const { id, full_name: fullName, private: isPrivate } = entry;
    if (typeof id !== 'number' || typeof fullName !== 'string' || typeof isPrivate !== 'boolean') {
      return null;
    }
    refs.push({ id, fullName, private: isPrivate });
  }
  return refs;
}

function toRepoInputs(refs: GithubRepoRef[]): RepoInput[] {
  return refs.map((ref) => ({ id: ref.id, private: ref.private, ...splitFullName(ref.fullName) }));
}

/** The only part of `ExecutionContext` this handler needs — narrower than Hono's or the ambient Workers type, so either satisfies it. */
interface WaitUntilContext {
  waitUntil(promise: Promise<unknown>): void;
}

async function handleInstallationEvent(
  env: Env,
  executionCtx: WaitUntilContext,
  body: Record<string, unknown>,
): Promise<void> {
  const installation = asInstallationRef(body.installation);
  if (!installation) return;
  const nowIso = new Date().toISOString();

  if (body.action === 'created') {
    await upsertInstallation(env.DB, {
      id: installation.id,
      accountLogin: installation.account.login,
      accountId: installation.account.id,
      accountType: installation.account.type,
    });
    const repos = asRepoRefs(body.repositories) ?? [];
    await upsertRepos(env.DB, installation.id, toRepoInputs(repos));
    executionCtx.waitUntil(runCollector(env, { installationId: installation.id }));
    return;
  }
  if (body.action === 'deleted' || body.action === 'suspend') {
    await suspendInstallation(env.DB, installation.id, nowIso);
    return;
  }
  if (body.action === 'unsuspend') {
    await unsuspendInstallation(env.DB, installation.id);
  }
}

async function handleInstallationRepositoriesEvent(
  env: Env,
  body: Record<string, unknown>,
): Promise<void> {
  const installation = asInstallationRef(body.installation);
  if (!installation) return;

  if (body.action === 'added') {
    const repos = asRepoRefs(body.repositories_added) ?? [];
    await upsertRepos(env.DB, installation.id, toRepoInputs(repos));
    return;
  }
  if (body.action === 'removed') {
    const repos = asRepoRefs(body.repositories_removed) ?? [];
    const nowIso = new Date().toISOString();
    for (const repo of repos) {
      await markRepoRemoved(env.DB, repo.id, nowIso);
    }
  }
}

const REPOSITORY_EVENT_ACTIONS = new Set(['renamed', 'transferred', 'privatized', 'publicized']);

async function handleRepositoryEvent(env: Env, body: Record<string, unknown>): Promise<void> {
  if (typeof body.action !== 'string' || !REPOSITORY_EVENT_ACTIONS.has(body.action)) return;
  const repository = body.repository;
  if (!isRecord(repository) || !isRecord(repository.owner)) return;
  const { id, name, private: isPrivate, owner } = repository;
  const { login } = owner;
  if (
    typeof id !== 'number' ||
    typeof name !== 'string' ||
    typeof isPrivate !== 'boolean' ||
    typeof login !== 'string'
  ) {
    return;
  }
  await updateRepo(env.DB, id, { owner: login, name, private: isPrivate });
}

webhooks.post('/webhooks/github', async (c) => {
  const rawBody = await c.req.text();
  const isValid = await verifyGithubSignature(
    rawBody,
    c.req.header('x-hub-signature-256'),
    c.env.GITHUB_WEBHOOK_SECRET,
  );
  if (!isValid) {
    return c.body(null, 401);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'malformed JSON body' }, 400);
  }
  if (!isRecord(body)) {
    return c.json({ error: 'malformed JSON body' }, 400);
  }

  switch (c.req.header('x-github-event')) {
    case 'installation':
      await handleInstallationEvent(c.env, c.executionCtx, body);
      break;
    case 'installation_repositories':
      await handleInstallationRepositoriesEvent(c.env, body);
      break;
    case 'repository':
      await handleRepositoryEvent(c.env, body);
      break;
    default:
      break;
  }

  return c.json({ ok: true }, 200);
});
