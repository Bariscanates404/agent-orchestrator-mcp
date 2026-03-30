import {
  getLeadRunById,
  getSettings,
  getTaskStatusCounts,
  listLeadRunEvents,
  listLeadRunItems,
  listLeadRunsForRepo,
  listRepoEvents,
  listTasksForRepo,
  openDb,
} from '../db/index.mjs';
import { shortenText } from '../lib/index.mjs';
import { nowIso } from '../shared/time.mjs';

const ACTIVE_STATUSES = new Set(['queued', 'preparing', 'running']);

export function buildDashboardPayload(repoRoot, stateRoot, limit = 40) {
  const db = openDb(stateRoot);
  try {
    const settings = getSettings(db);
    const tasks = listTasksForRepo(db, repoRoot, { limit });
    const events = listRepoEvents(db, repoRoot, { limit: 80 });
    const activeWorkers = tasks
      .filter((task) => ACTIVE_STATUSES.has(task.status))
      .map((task) => ({
        id: task.id,
        label: task.label,
        status: task.status,
        backend: task.backend,
        requestedBackend: task.requestedBackend,
        runnerPid: task.runnerPid,
        agentPid: task.agentPid,
        parentTaskId: task.parentTaskId,
        startedAt: task.startedAt,
      }));

    return {
      generatedAt: nowIso(),
      repoRoot,
      stateRoot,
      settings: {
        leadBackend: settings.leadBackend || 'codex',
        defaultWorkerBackend: settings.defaultWorkerBackend || 'claude',
        codexFallbackBackend: settings.codexFallbackBackend || 'claude',
      },
      counts: getTaskStatusCounts(db, repoRoot),
      activeWorkersCount: activeWorkers.length,
      activeWorkers,
      tasks: tasks.map((task) => ({
        id: task.id,
        label: task.label,
        requestedBackend: task.requestedBackend,
        backend: task.backend,
        fallbackUsed: task.fallbackUsed,
        status: task.status,
        promptSummary: shortenText(task.promptSummary || task.prompt),
        updatedAt: task.updatedAt,
        completedAt: task.completedAt,
        parentTaskId: task.parentTaskId,
        escalationReason: task.escalationReason,
        error: task.error,
      })),
      recentEvents: events.map((event) => ({
        id: event.id,
        taskId: event.taskId,
        stream: event.stream,
        eventType: event.eventType,
        content: shortenText(event.content || '', 220),
        createdAt: event.createdAt,
      })),
    };
  } finally {
    db.close();
  }
}

export function buildLeadRunsPayload(repoRoot, stateRoot, limit = 40) {
  const db = openDb(stateRoot);
  try {
    const runs = listLeadRunsForRepo(db, repoRoot, { limit });
    return {
      generatedAt: nowIso(),
      count: runs.length,
      runs: runs.map((run) => {
        const items = listLeadRunItems(db, run.id);
        const completedItems = items.filter((item) => item.status === 'completed').length;
        const totalItems = items.length;
        return {
          id: run.id,
          label: run.label,
          objective: shortenText(run.objective, 200),
          status: run.status,
          phase: run.phase,
          paused: run.paused,
          leadBackend: run.leadBackend,
          workerBackend: run.workerBackend,
          evaluationRound: run.evaluationRound,
          maxEvalRounds: run.maxEvalRounds,
          maxParallel: run.maxParallel,
          maxRounds: run.maxRounds,
          completedItems,
          totalItems,
          runnerPid: run.runnerPid,
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
          completedAt: run.completedAt,
          error: run.error,
          resultSummary: run.resultSummary,
        };
      }),
    };
  } finally {
    db.close();
  }
}

export function buildLeadRunDetailPayload(stateRoot, runId) {
  const db = openDb(stateRoot);
  try {
    const run = getLeadRunById(db, runId);
    if (!run) {
      return null;
    }
    const items = listLeadRunItems(db, runId);
    const events = listLeadRunEvents(db, runId, { limit: 300 });
    return { run, items, events };
  } finally {
    db.close();
  }
}
