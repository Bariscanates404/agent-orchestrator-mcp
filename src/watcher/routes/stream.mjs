import {
  getLeadRunById,
  getTaskById,
  listLeadRunEvents,
  listLeadRunItems,
  listTaskEvents,
  openDb,
} from '../../db/index.mjs';
import { sendSse } from '../http-helpers.mjs';
import { buildDashboardPayload, buildLeadRunsPayload } from '../payloads.mjs';

export async function handleStream(req, res, url, { repoRoot, stateRoot }) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 1000\n\n');

  const taskId = url.searchParams.get('taskId');
  const leadRunId = url.searchParams.get('leadRunId');
  let lastTaskEventId = Number(url.searchParams.get('afterId') || 0);
  let lastTaskUpdatedAt = '';
  let lastDashboardDigest = '';
  let lastLeadEventId = 0;
  let lastLeadRunUpdatedAt = '';
  let lastLeadRunsDigest = '';

  const tick = async () => {
    if (leadRunId) {
      const db = openDb(stateRoot);
      try {
        const run = getLeadRunById(db, leadRunId);
        if (!run) {
          sendSse(res, 'stream_error', { error: 'Lead run not found', leadRunId });
          return;
        }
        const events = listLeadRunEvents(db, leadRunId, { afterId: lastLeadEventId, limit: 200 });
        for (const event of events) {
          lastLeadEventId = Math.max(lastLeadEventId, event.id);
          sendSse(res, 'lead_event', event);
        }
        if (run.updatedAt !== lastLeadRunUpdatedAt) {
          lastLeadRunUpdatedAt = run.updatedAt;
          const items = listLeadRunItems(db, leadRunId);
          sendSse(res, 'lead_state', { run, items });
        }
      } finally {
        db.close();
      }
      return;
    }

    if (taskId) {
      const db = openDb(stateRoot);
      try {
        const task = getTaskById(db, taskId);
        if (!task) {
          sendSse(res, 'stream_error', { error: 'Task not found', taskId });
          return;
        }
        const events = listTaskEvents(db, taskId, { afterId: lastTaskEventId, limit: 200 });
        for (const event of events) {
          lastTaskEventId = Math.max(lastTaskEventId, event.id);
          sendSse(res, 'task_event', event);
        }
        if (task.updatedAt !== lastTaskUpdatedAt) {
          lastTaskUpdatedAt = task.updatedAt;
          sendSse(res, 'task_state', { task });
        }
      } finally {
        db.close();
      }
      return;
    }

    const dashboard = buildDashboardPayload(repoRoot, stateRoot, Number(url.searchParams.get('limit') || 40));
    const digest = JSON.stringify({
      counts: dashboard.counts,
      tasks: dashboard.tasks.map((task) => [task.id, task.status, task.updatedAt, task.completedAt, task.error]),
    });
    if (digest !== lastDashboardDigest) {
      lastDashboardDigest = digest;
      sendSse(res, 'dashboard', dashboard);
    }

    const leadRuns = buildLeadRunsPayload(repoRoot, stateRoot, 20);
    const leadDigest = JSON.stringify(
      leadRuns.runs.map((r) => [r.id, r.status, r.phase, r.updatedAt, r.completedItems, r.totalItems, r.paused]),
    );
    if (leadDigest !== lastLeadRunsDigest) {
      lastLeadRunsDigest = leadDigest;
      sendSse(res, 'lead_runs', leadRuns);
    }
  };

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(interval);
  };

  const interval = setInterval(() => {
    if (closed || !res.writable) {
      cleanup();
      return;
    }
    tick().catch((error) => {
      try {
        if (res.writable) sendSse(res, 'stream_error', { error: error.message || String(error) });
      } catch {
        /* connection already gone */
      }
    });
  }, 1000);

  req.on('close', cleanup);
  req.on('error', cleanup);

  await tick();
}
