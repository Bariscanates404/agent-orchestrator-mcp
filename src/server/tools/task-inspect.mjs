import path from 'node:path';
import { z } from 'zod';
import { buildDashboardState, getRepoStatePaths, getTaskSummary, pathExists, readJson } from '../../lib/index.mjs';
import { taskFilePath } from '../../lib/paths.mjs';
import { toTextResult } from '../../shared/mcp-result.mjs';

async function loadTask(taskId, repoRoot, stateRoot) {
  const filePath = taskFilePath(taskId, repoRoot, stateRoot);
  if (!(await pathExists(filePath))) {
    throw new Error(`Task not found: ${taskId}`);
  }
  return readJson(filePath);
}

async function listTasks(repoRoot, stateRoot, status) {
  const dirs = getRepoStatePaths(repoRoot, stateRoot);
  if (!(await pathExists(dirs.tasksDir))) {
    return [];
  }
  const fsP = await import('node:fs/promises');
  const entries = (await fsP.readdir(dirs.tasksDir))
    .filter((entry) => entry.endsWith('.json'))
    .sort()
    .reverse();
  const tasks = [];
  for (const entry of entries) {
    const task = await readJson(path.join(dirs.tasksDir, entry));
    if (!status || task.status === status) {
      tasks.push(task);
    }
  }
  return tasks;
}

export function registerTaskInspectTools(server, { repoRoot, stateRoot }) {
  server.registerTool(
    'list_agent_tasks',
    {
      description: 'List recent orchestrated tasks for this repository.',
      inputSchema: z
        .object({
          status: z.enum(['queued', 'preparing', 'running', 'completed', 'failed', 'cancelled']).optional(),
        })
        .strict(),
    },
    async (input) => {
      const tasks = await listTasks(repoRoot, stateRoot, input.status);
      return toTextResult('list_agent_tasks', {
        count: tasks.length,
        tasks: tasks.map((task) => ({
          id: task.id,
          label: task.label,
          backend: task.backend,
          requestedBackend: task.requestedBackend || task.backend,
          fallbackUsed: Boolean(task.fallbackUsed),
          status: task.status,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          worktreeMode: task.worktree?.mode,
          worktreePath: task.worktree?.path,
        })),
      });
    },
  );

  server.registerTool(
    'get_dashboard_snapshot',
    {
      description: 'Summarize recent tasks for watcher-style dashboards and local observability UIs.',
      inputSchema: z
        .object({
          limit: z.number().int().min(1).max(100).optional(),
          status: z.enum(['queued', 'preparing', 'running', 'completed', 'failed', 'cancelled']).optional(),
        })
        .strict(),
    },
    async (input) => {
      const snapshot = await buildDashboardState(repoRoot, stateRoot, input);
      return toTextResult('get_dashboard_snapshot', snapshot);
    },
  );

  server.registerTool(
    'get_agent_task',
    {
      description: 'Inspect one task, including stdout/stderr tails and diff summary for isolated worktrees.',
      inputSchema: z
        .object({
          taskId: z.string().min(1),
        })
        .strict(),
    },
    async (input) => {
      const task = await loadTask(input.taskId, repoRoot, stateRoot);
      const summary = await getTaskSummary(task);
      return toTextResult('get_agent_task', {
        task,
        summary,
      });
    },
  );
}

// Re-export loadTask for escalation tool
export { loadTask };
