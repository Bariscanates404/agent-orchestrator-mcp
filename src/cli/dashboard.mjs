import { getSettings, getTaskStatusCounts, listRepoEvents, listTasksForRepo, openDb } from '../db/index.mjs';
import { resolveRepoRoot, resolveStateRoot, shortenText } from '../lib/index.mjs';
import { nowIso } from '../shared/time.mjs';

const repoRoot = resolveRepoRoot();
const stateRoot = resolveStateRoot();
const db = openDb(stateRoot);

try {
  const settings = getSettings(db);
  const tasks = listTasksForRepo(db, repoRoot, { limit: 20 });
  const events = listRepoEvents(db, repoRoot, { limit: 40 });
  console.log(
    JSON.stringify(
      {
        generatedAt: nowIso(),
        repoRoot,
        stateRoot,
        settings: {
          leadBackend: settings.leadBackend || 'codex',
          defaultWorkerBackend: settings.defaultWorkerBackend || 'claude',
          codexFallbackBackend: settings.codexFallbackBackend || 'claude',
        },
        counts: getTaskStatusCounts(db, repoRoot),
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
        })),
        recentEvents: events.map((event) => ({
          id: event.id,
          taskId: event.taskId,
          stream: event.stream,
          eventType: event.eventType,
          content: shortenText(event.content || '', 180),
          createdAt: event.createdAt,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}
