import { Hono } from 'hono';
import type { Env } from './env';
import { webhooks } from './routes/webhooks';
import { badge } from './routes/badge';
import { api } from './routes/api';
import { verify } from './routes/verify';
import { auth } from './routes/auth';
import { dashboard } from './routes/dashboard';
import { landing } from './routes/landing';
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
app.route('/', auth);
app.route('/', dashboard);
// Mounted LAST (spec overview §Step 2): GET / is the most general route in
// this assembly, so it must not shadow any more specific path above it.
app.route('/', landing);

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
