import { z } from 'zod';
import { insertTaskEvent, openDb, upsertTask } from '../../db/index.mjs';
import {
  buildTaskPaths,
  detectBackend,
  ensureRepoStatePaths,
  makeTaskId,
  sanitizeName,
  summarizePrompt,
  writeJsonAtomic,
} from '../../lib/index.mjs';
import { toTextResult } from '../../shared/mcp-result.mjs';
import { getRuntimeSettings } from '../../shared/settings.mjs';
import { spawnDetached } from '../../shared/spawn-detached.mjs';
import { nowIso } from '../../shared/time.mjs';

async function resolveTaskBackend(rawTask, stateRoot) {
  const runtimeSettings = getRuntimeSettings(stateRoot);
  const requestedBackend = rawTask.backend || runtimeSettings.defaultWorkerBackend;
  const requestedState = await detectBackend(requestedBackend, requestedBackend === 'codex' ? ['-V'] : ['--version']);
  if (requestedState.available) {
    return {
      ...rawTask,
      backend: requestedBackend,
      requestedBackend,
      fallbackBackend: rawTask.fallbackBackend || null,
      fallbackUsed: false,
    };
  }

  const fallbackBackend =
    rawTask.fallbackBackend || (requestedBackend === 'codex' ? runtimeSettings.codexFallbackBackend : null);

  if (fallbackBackend && fallbackBackend !== requestedBackend) {
    const fallbackState = await detectBackend(fallbackBackend, fallbackBackend === 'codex' ? ['-V'] : ['--version']);
    if (fallbackState.available) {
      return {
        ...rawTask,
        backend: fallbackBackend,
        requestedBackend,
        fallbackBackend,
        fallbackUsed: true,
      };
    }
  }

  throw new Error(`${requestedBackend} CLI is not available on PATH`);
}

async function createTaskRecord(rawTask, { repoRoot, stateRoot, runnerPath }) {
  const effectiveCwd = rawTask.cwd || repoRoot;
  await ensureRepoStatePaths(repoRoot, stateRoot);
  const taskId = makeTaskId(rawTask.label || rawTask.backend || 'agent');
  const paths = buildTaskPaths(taskId, repoRoot, stateRoot);
  const worktreeMode = rawTask.cwd ? 'reuse_repo' : rawTask.worktreeMode || 'git_worktree';
  const branchLabel = rawTask.branchName || `${sanitizeName(rawTask.label || rawTask.backend)}-${taskId.slice(0, 20)}`;
  const now = nowIso();
  const task = {
    id: taskId,
    label: rawTask.label || `${rawTask.backend}-${taskId}`,
    requestedBackend: rawTask.requestedBackend || rawTask.backend,
    backend: rawTask.backend,
    fallbackBackend: rawTask.fallbackBackend || null,
    fallbackUsed: Boolean(rawTask.fallbackUsed),
    prompt: rawTask.task,
    promptSummary: summarizePrompt(rawTask.task),
    repoRoot: effectiveCwd,
    stateRoot,
    baseRef: rawTask.baseRef || 'HEAD',
    model: rawTask.model || null,
    effort: rawTask.effort || null,
    profile: rawTask.profile || null,
    additionalArgs: rawTask.additionalArgs || [],
    systemPrompt: rawTask.systemPrompt || null,
    allowDirtyBase: Boolean(rawTask.allowDirtyBase),
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    exitCode: null,
    exitSignal: null,
    runnerPid: null,
    agentPid: null,
    error: null,
    parentTaskId: rawTask.parentTaskId || null,
    escalationReason: rawTask.escalationReason || null,
    status: 'queued',
    logs: {
      stdout: paths.stdout,
      stderr: paths.stderr,
      runnerStdout: paths.runnerStdout,
      runnerStderr: paths.runnerStderr,
    },
    worktree: {
      mode: worktreeMode,
      path: worktreeMode === 'git_worktree' ? paths.worktreePath : effectiveCwd,
      branch: worktreeMode === 'git_worktree' ? `mcp/${branchLabel}` : null,
      created: false,
    },
    execution: null,
  };

  await writeJsonAtomic(paths.taskFile, task);

  const child = spawnDetached(process.execPath, [runnerPath, paths.taskFile], {
    cwd: effectiveCwd,
    env: {
      ...process.env,
      TEAMLEAD_REPO_ROOT: effectiveCwd,
      TEAMLEAD_STATE_ROOT: stateRoot,
    },
    stdoutPath: paths.runnerStdout,
    stderrPath: paths.runnerStderr,
  });

  task.runnerPid = child.pid;
  task.updatedAt = nowIso();
  await writeJsonAtomic(paths.taskFile, task);
  const db = openDb(stateRoot);
  try {
    upsertTask(db, task);
    insertTaskEvent(db, {
      taskId: task.id,
      repoRoot: task.repoRoot,
      stream: 'system',
      eventType: 'task_created',
      content: `Task queued for ${task.backend}`,
      metadata: {
        label: task.label,
        requestedBackend: task.requestedBackend,
        backend: task.backend,
        fallbackUsed: task.fallbackUsed,
        runnerPid: task.runnerPid,
      },
    });
  } finally {
    db.close();
  }

  return task;
}

const taskInputSchema = z
  .object({
    backend: z.enum(['claude', 'codex']).optional(),
    fallbackBackend: z.enum(['claude', 'codex']).optional(),
    task: z.string().min(1),
    label: z.string().min(1).optional(),
    cwd: z
      .string()
      .optional()
      .describe(
        'Working directory override. If set, the agent runs in this directory instead of the default repoRoot.',
      ),
    worktreeMode: z.enum(['git_worktree', 'reuse_repo']).optional(),
    allowDirtyBase: z.boolean().optional(),
    baseRef: z.string().optional(),
    model: z.string().optional(),
    effort: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
    profile: z.string().optional(),
    branchName: z.string().optional(),
    parentTaskId: z.string().optional(),
    escalationReason: z.string().optional(),
    systemPrompt: z.string().optional(),
    additionalArgs: z.array(z.string()).optional(),
  })
  .strict();

export function registerTaskLaunchTools(server, ctx) {
  server.registerTool(
    'launch_agent_task',
    {
      description: 'Launch a Codex or Claude CLI task in either the current repo or an isolated git worktree.',
      inputSchema: taskInputSchema,
    },
    async (input) => {
      const normalizedInput = await resolveTaskBackend(input, ctx.stateRoot);
      const task = await createTaskRecord(normalizedInput, ctx);
      return toTextResult('launch_agent_task', {
        id: task.id,
        status: task.status,
        requestedBackend: task.requestedBackend,
        backend: task.backend,
        fallbackUsed: task.fallbackUsed,
        label: task.label,
        worktree: task.worktree,
        logs: task.logs,
        runnerPid: task.runnerPid,
      });
    },
  );

  server.registerTool(
    'launch_agent_batch',
    {
      description: 'Launch multiple CLI agent tasks at once. Use this to fan out 3-4 parallel subtasks cleanly.',
      inputSchema: z
        .object({
          tasks: z.array(taskInputSchema).min(1).max(12),
        })
        .strict(),
    },
    async (input) => {
      const created = [];
      for (const taskInput of input.tasks) {
        const normalizedInput = await resolveTaskBackend(taskInput, ctx.stateRoot);
        const task = await createTaskRecord(normalizedInput, ctx);
        created.push({
          id: task.id,
          status: task.status,
          requestedBackend: task.requestedBackend,
          backend: task.backend,
          fallbackUsed: task.fallbackUsed,
          label: task.label,
          worktree: task.worktree,
          runnerPid: task.runnerPid,
        });
      }
      return toTextResult('launch_agent_batch', { count: created.length, tasks: created });
    },
  );
}

// Exported for escalation tool
export { createTaskRecord, resolveTaskBackend };
