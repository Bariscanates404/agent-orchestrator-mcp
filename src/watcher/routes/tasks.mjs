import { getTaskById, listTaskEvents, openDb } from '../../db/index.mjs';
import { getRuntimeSettings } from '../../shared/settings.mjs';
import { readBody, sendJson } from '../http-helpers.mjs';
import { cancelTask, cleanupTask, escalateTask, launchTasks } from '../mcp-proxy.mjs';

function extractSessionHints(task, events = []) {
  const sessionHints = {
    backend: task.backend,
    claudeSessionId: null,
    codexThreadId: null,
  };
  for (const event of events) {
    const content = String(event.content || '');
    if (!sessionHints.claudeSessionId) {
      const claudeMatch = content.match(/"session_id":"([^"]+)"/);
      if (claudeMatch) {
        sessionHints.claudeSessionId = claudeMatch[1];
      }
    }
    if (!sessionHints.codexThreadId) {
      const codexMatch = content.match(/"thread_id":"([^"]+)"/);
      if (codexMatch) {
        sessionHints.codexThreadId = codexMatch[1];
      }
    }
    if (sessionHints.claudeSessionId && sessionHints.codexThreadId) {
      break;
    }
  }
  return sessionHints;
}

export function registerTaskRoutes(router, { repoRoot, stateRoot }) {
  router.get(/^\/api\/tasks\/[^/]+$/, (_req, res, url) => {
    const taskId = decodeURIComponent(url.pathname.split('/').pop());
    const runtime = getRuntimeSettings(stateRoot);
    const db = openDb(stateRoot);
    try {
      const task = getTaskById(db, taskId);
      if (!task) {
        return sendJson(res, 404, { error: 'Task not found' });
      }
      const events = listTaskEvents(db, taskId, { limit: 400 });
      const sessionHints = extractSessionHints(task, events);
      return sendJson(res, 200, {
        task,
        events,
        sessionHints,
        orchestration: {
          leadBackend: runtime.leadBackend,
          mode: 'manual-launch',
          note: 'Current watcher launches worker tasks directly. Lead backend is policy metadata, not autonomous lead prompt chaining.',
        },
      });
    } finally {
      db.close();
    }
  });

  router.get(/^\/api\/tasks\/[^/]+\/events$/, (_req, res, url) => {
    const parts = url.pathname.split('/');
    const taskId = decodeURIComponent(parts[3]);
    const db = openDb(stateRoot);
    try {
      const events = listTaskEvents(db, taskId, {
        afterId: Number(url.searchParams.get('afterId') || 0),
        limit: Number(url.searchParams.get('limit') || 200),
      });
      return sendJson(res, 200, { events });
    } finally {
      db.close();
    }
  });

  router.post('/api/tasks/launch', async (req, res) => {
    const body = await readBody(req);
    const result = await launchTasks(repoRoot, stateRoot, body.tasks || []);
    return sendJson(res, 200, result);
  });

  router.post(/^\/api\/tasks\/[^/]+\/escalate$/, async (req, res, url) => {
    const taskId = decodeURIComponent(url.pathname.split('/')[3]);
    const body = await readBody(req);
    const result = await escalateTask(repoRoot, stateRoot, taskId, body);
    return sendJson(res, 200, result);
  });

  router.post(/^\/api\/tasks\/[^/]+\/cancel$/, async (_req, res, url) => {
    const taskId = decodeURIComponent(url.pathname.split('/')[3]);
    const result = await cancelTask(repoRoot, stateRoot, taskId);
    return sendJson(res, 200, result);
  });

  router.post(/^\/api\/tasks\/[^/]+\/cleanup$/, async (req, res, url) => {
    const taskId = decodeURIComponent(url.pathname.split('/')[3]);
    const body = await readBody(req);
    const result = await cleanupTask(repoRoot, stateRoot, taskId, Boolean(body.deleteBranch));
    return sendJson(res, 200, result);
  });
}
