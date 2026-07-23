import { Hono } from 'hono';
import type { Env } from './env';
import { webhooks } from './routes/webhooks';
import { badge } from './routes/badge';
import { api } from './routes/api';
import { verify } from './routes/verify';
import { runCollector } from './collector/run';

/**
 * Worker entry point. Assembly only — no business logic lives here
 * (rules/library/stacks/hono/rules.md).
 */
const app = new Hono<{ Bindings: Env }>();

app.route('/', webhooks);
app.route('/', badge);
app.route('/', api);
app.route('/', verify);

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
