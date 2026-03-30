import { z } from 'zod';
import { insertTaskEvent, listTaskEvents, openDb, upsertTask } from '../../db/index.mjs';
import { pathExists, shortenText, spawnAndWait, writeJsonAtomic } from '../../lib/index.mjs';
import { taskFilePath } from '../../lib/paths.mjs';
import { TASK_TERMINAL_STATES } from '../../shared/constants.mjs';
import { toTextResult } from '../../shared/mcp-result.mjs';
import { nowIso } from '../../shared/time.mjs';
import { loadTask } from './task-inspect.mjs';
import { createTaskRecord, resolveTaskBackend } from './task-launch.mjs';

function buildEscalationPrompt(task, events, reason) {
  const recentTranscript = events
    .slice(-20)
    .map((event) => {
      const header = `[${event.stream}:${event.eventType}]`;
      const body = shortenText(event.content || '', 800);
      return body ? `${header}\n${body}` : header;
    })
    .join('\n\n');

  return [
    'Take over a blocked worker task and finish it decisively.',
    `Escalation reason: ${reason || 'Previous worker stalled or could not complete the task.'}`,
    '',
    'Original task metadata:',
    `- taskId: ${task.id}`,
    `- label: ${task.label}`,
    `- requested backend: ${task.requestedBackend || task.backend}`,
    `- actual backend: ${task.backend}`,
    `- status: ${task.status}`,
    task.error ? `- error: ${task.error}` : '- error: none recorded',
    '',
    'Original instruction:',
    task.prompt,
    '',
    'Recent worker transcript:',
    recentTranscript || '(no transcript captured yet)',
    '',
    'Instructions:',
    '- Continue from the current state instead of restarting blindly.',
    '- If code changes are needed, make them cleanly and verify them.',
    '- End with a short result summary and the remaining risk, if any.',
  ].join('\n');
}

export function registerTaskLifecycleTools(server, ctx) {
  const { repoRoot, stateRoot } = ctx;

  server.registerTool(
    'escalate_agent_task',
    {
      description:
        'Escalate an existing task to a stronger worker, usually Codex, while preserving the original prompt and transcript.',
      inputSchema: z
        .object({
          taskId: z.string().min(1),
          backend: z.enum(['claude', 'codex']).optional(),
          fallbackBackend: z.enum(['claude', 'codex']).optional(),
          label: z.string().min(1).optional(),
          reason: z.string().min(1).optional(),
          worktreeMode: z.enum(['git_worktree', 'reuse_repo']).optional(),
          allowDirtyBase: z.boolean().optional(),
          baseRef: z.string().optional(),
          model: z.string().optional(),
          effort: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
          profile: z.string().optional(),
          branchName: z.string().optional(),
          systemPrompt: z.string().optional(),
          additionalArgs: z.array(z.string()).optional(),
        })
        .strict(),
    },
    async (input) => {
      const sourceTask = await loadTask(input.taskId, repoRoot, stateRoot);
      const db = openDb(stateRoot);
      let events;
      try {
        events = listTaskEvents(db, input.taskId, { limit: 60 });
      } finally {
        db.close();
      }

      const normalizedInput = await resolveTaskBackend(
        {
          backend: input.backend || 'codex',
          fallbackBackend: input.fallbackBackend,
          task: buildEscalationPrompt(sourceTask, events, input.reason),
          label: input.label || `${sourceTask.label}-escalated`,
          worktreeMode: input.worktreeMode || sourceTask.worktree?.mode || 'reuse_repo',
          allowDirtyBase: input.allowDirtyBase ?? sourceTask.allowDirtyBase,
          baseRef: input.baseRef || sourceTask.baseRef,
          model: input.model,
          effort: input.effort || sourceTask.effort,
          profile: input.profile || sourceTask.profile,
          branchName: input.branchName,
          parentTaskId: sourceTask.id,
          escalationReason: input.reason || 'Manual escalation',
          systemPrompt: input.systemPrompt,
          additionalArgs: input.additionalArgs,
        },
        stateRoot,
      );

      const task = await createTaskRecord(normalizedInput, ctx);
      const eventDb = openDb(stateRoot);
      try {
        insertTaskEvent(eventDb, {
          taskId: sourceTask.id,
          repoRoot,
          stream: 'system',
          eventType: 'escalated',
          content: `Escalated to ${task.backend} as task ${task.id}`,
          metadata: {
            targetTaskId: task.id,
            targetBackend: task.backend,
            fallbackUsed: task.fallbackUsed,
          },
        });
      } finally {
        eventDb.close();
      }

      return toTextResult('escalate_agent_task', {
        sourceTaskId: sourceTask.id,
        escalatedTaskId: task.id,
        requestedBackend: task.requestedBackend,
        backend: task.backend,
        fallbackUsed: task.fallbackUsed,
        label: task.label,
        worktree: task.worktree,
        runnerPid: task.runnerPid,
      });
    },
  );

  server.registerTool(
    'cancel_agent_task',
    {
      description: 'Cancel a running task by signalling its detached runner process group.',
      inputSchema: z
        .object({
          taskId: z.string().min(1),
        })
        .strict(),
    },
    async (input) => {
      const task = await loadTask(input.taskId, repoRoot, stateRoot);
      if (TASK_TERMINAL_STATES.has(task.status)) {
        return toTextResult('cancel_agent_task', {
          taskId: task.id,
          status: task.status,
          cancelled: false,
          reason: 'Task already finished.',
        });
      }
      if (!task.runnerPid) {
        throw new Error(`Task ${task.id} has no runnerPid to signal.`);
      }

      try {
        process.kill(-task.runnerPid, 'SIGTERM');
      } catch {
        process.kill(task.runnerPid, 'SIGTERM');
      }

      const updated = {
        ...task,
        status: 'cancelled',
        updatedAt: nowIso(),
        completedAt: nowIso(),
        exitSignal: 'SIGTERM',
      };
      await writeJsonAtomic(taskFilePath(task.id, repoRoot, stateRoot), updated);
      const db = openDb(stateRoot);
      try {
        upsertTask(db, updated);
        insertTaskEvent(db, {
          taskId: updated.id,
          repoRoot,
          stream: 'system',
          eventType: 'cancelled',
          content: 'Task cancelled by operator.',
          metadata: {
            runnerPid: updated.runnerPid,
            exitSignal: updated.exitSignal,
          },
        });
      } finally {
        db.close();
      }

      return toTextResult('cancel_agent_task', {
        taskId: task.id,
        status: 'cancelled',
        cancelled: true,
      });
    },
  );

  server.registerTool(
    'cleanup_agent_task',
    {
      description: 'Remove an isolated worktree after task review. Optionally delete the task branch too.',
      inputSchema: z
        .object({
          taskId: z.string().min(1),
          deleteBranch: z.boolean().optional(),
        })
        .strict(),
    },
    async (input) => {
      const task = await loadTask(input.taskId, repoRoot, stateRoot);
      if (!TASK_TERMINAL_STATES.has(task.status)) {
        throw new Error(`Task ${task.id} is still ${task.status}. Finish or cancel it before cleanup.`);
      }
      if (task.worktree?.mode !== 'git_worktree' || !task.worktree?.path) {
        return toTextResult('cleanup_agent_task', {
          taskId: task.id,
          cleaned: false,
          reason: 'Task did not create an isolated worktree.',
        });
      }

      let removed = false;
      let branchDeleted = false;
      if (await pathExists(task.worktree.path)) {
        const remove = await spawnAndWait('git', ['worktree', 'remove', '--force', task.worktree.path], repoRoot);
        if (!remove.ok) {
          throw new Error(remove.stderr || remove.stdout || 'git worktree remove failed');
        }
        removed = true;
      }
      if (input.deleteBranch && task.worktree.branch) {
        const dropBranch = await spawnAndWait('git', ['branch', '-D', task.worktree.branch], repoRoot);
        if (!dropBranch.ok) {
          throw new Error(dropBranch.stderr || dropBranch.stdout || 'git branch delete failed');
        }
        branchDeleted = true;
      }
      const db = openDb(stateRoot);
      try {
        insertTaskEvent(db, {
          taskId: task.id,
          repoRoot,
          stream: 'system',
          eventType: 'cleanup',
          content: `Cleaned worktree ${task.worktree.path}`,
          metadata: {
            cleaned: removed,
            branchDeleted,
            branch: task.worktree.branch,
          },
        });
      } finally {
        db.close();
      }

      return toTextResult('cleanup_agent_task', {
        taskId: task.id,
        cleaned: removed,
        branchDeleted,
        worktreePath: task.worktree.path,
        branch: task.worktree.branch,
      });
    },
  );
}
