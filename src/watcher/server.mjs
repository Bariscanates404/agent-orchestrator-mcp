import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRepoRoot, resolveStateRoot } from '../lib/index.mjs';
import { sendJson } from './http-helpers.mjs';
import { registerDashboardRoutes } from './routes/dashboard.mjs';
import { registerLeadRoutes } from './routes/leads.mjs';
import { handleStream } from './routes/stream.mjs';
import { registerTaskRoutes } from './routes/tasks.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', '..', 'public');
const repoRoot = resolveRepoRoot();
const stateRoot = resolveStateRoot();
const port = Number(process.env.ORCHESTRATOR_WATCHER_PORT || 4317);

// Simple route registry
class Router {
  constructor() {
    this.routes = [];
  }

  get(pattern, handler) {
    this.routes.push({ method: 'GET', pattern, handler });
  }

  post(pattern, handler) {
    this.routes.push({ method: 'POST', pattern, handler });
  }

  match(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method) {
        continue;
      }
      if (typeof route.pattern === 'string' && route.pattern === pathname) {
        return route.handler;
      }
      if (route.pattern instanceof RegExp && route.pattern.test(pathname)) {
        return route.handler;
      }
    }
    return null;
  }
}

const router = new Router();
const ctx = { publicDir, repoRoot, stateRoot };

registerDashboardRoutes(router, ctx);
registerTaskRoutes(router, ctx);
registerLeadRoutes(router, ctx);

// Demo route (imported lazily)
router.post('/api/demo/claude-batch', async (_req, res) => {
  const { runClaudeDemoBatch } = await import('../cli/demo-claude-batch.mjs');
  const result = await runClaudeDemoBatch({ repoRoot, stateRoot });
  return sendJson(res, 200, result);
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  try {
    // SSE stream handled separately
    if (req.method === 'GET' && url.pathname === '/api/stream') {
      return handleStream(req, res, url, { repoRoot, stateRoot });
    }

    const handler = router.match(req.method, url.pathname);
    if (handler) {
      return await handler(req, res, url);
    }

    return sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || String(error) });
  }
});

server.listen(port, () => {
  console.log(
    JSON.stringify(
      {
        status: 'watcher_ready',
        port,
        repoRoot,
        stateRoot,
        url: `http://localhost:${port}`,
      },
      null,
      2,
    ),
  );
});
