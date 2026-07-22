import { Hono } from 'hono';
import type { Env } from './env';
import { webhooks } from './routes/webhooks';
import { runCollector } from './collector/run';

/**
 * Worker entry point. Assembly only — no business logic lives here
 * (rules/library/stacks/hono/rules.md). M1 has no public surface, so the
 * only mounted route is the GitHub webhook receiver.
 */
const app = new Hono<{ Bindings: Env }>();

app.route('/', webhooks);

export default {
  fetch: app.fetch,
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(runCollector(env));
  },
};
