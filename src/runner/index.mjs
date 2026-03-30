import { spawn } from 'node:child_process';
import fsPromises from 'node:fs/promises';
import { insertTaskEvent, openDb, upsertTask } from '../db/index.mjs';
import { appendToWorkspace, pathExists, readJson, updateJsonFile, writeJsonAtomic } from '../lib/index.mjs';
import { nowIso } from '../shared/time.mjs';
import { buildClaudeArgs, buildCodexArgs } from './agents.mjs';
import { bindProcessStreams, closeStreams } from './streams.mjs';
import { prepareWorktree } from './worktree.mjs';

const taskFile = process.argv[2];
if (!taskFile) {
  throw new Error('Usage: node runner.mjs <task-file>');
}

let child = null;
let db = null;
let streams = null;
let currentTaskSnapshot = null;

function writeEvent(stream, eventType, content, metadata = {}) {
  if (!db) {
    return;
  }
  try {
    const task = currentTaskSnapshot;
    if (!task) {
      return;
    }
    insertTaskEvent(db, {
      taskId: task.id,
      repoRoot: task.repoRoot,
      stream,
      eventType,
      content,
      metadata,
    });
  } catch {
    // do not crash the runner because of event persistence failures
  }
}

async function updateTask(patch, eventType = null, eventContent = null, eventMetadata = null) {
  const nextTask = await updateJsonFile(taskFile, (task) => ({
    ...task,
    ...patch,
    updatedAt: nowIso(),
  }));
  currentTaskSnapshot = nextTask;
  if (db) {
    upsertTask(db, nextTask);
  }
  if (eventType) {
    writeEvent('status', eventType, eventContent || nextTask.status, eventMetadata || patch);
  }
  return nextTask;
}

function classifyExit(code, signal) {
  if (signal === 'SIGTERM' || signal === 'SIGINT') {
    return 'cancelled';
  }
  return code === 0 ? 'completed' : 'failed';
}

async function main() {
  const task = await readJson(taskFile);
  currentTaskSnapshot = task;
  db = openDb(task.stateRoot);
  upsertTask(db, task);
  writeEvent('system', 'runner_started', `Runner started for ${task.id}`, { taskFile });

  await updateTask({ status: 'preparing', startedAt: nowIso() }, 'status_changed', 'preparing');

  const prepared = await prepareWorktree(task);
  const preparedTask = await updateTask(
    {
      status: 'running',
      worktree: {
        ...task.worktree,
        path: prepared.path,
        branch: prepared.branch,
        created: prepared.created,
      },
    },
    'status_changed',
    'running',
  );

  const execution =
    preparedTask.backend === 'claude'
      ? buildClaudeArgs(preparedTask, prepared.path)
      : buildCodexArgs(preparedTask, prepared.path);

  child = spawn(execution.command, execution.args, {
    cwd: execution.cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  streams = bindProcessStreams(preparedTask, child, writeEvent);

  await updateTask(
    {
      agentPid: child.pid,
      execution: {
        command: execution.command,
        args: execution.args,
        cwd: execution.cwd,
      },
    },
    'agent_started',
    `${execution.command} started`,
    {
      agentPid: child.pid,
      cwd: execution.cwd,
    },
  );

  const { code, signal } = await new Promise((resolve) => {
    child.on('exit', (exitCode, exitSignal) => resolve({ code: exitCode, signal: exitSignal }));
  });

  await closeStreams(streams?.stdoutStream, streams?.stderrStream);

  const finalStatus = classifyExit(code, signal);
  await updateTask(
    {
      status: finalStatus,
      completedAt: nowIso(),
      exitCode: code,
      exitSignal: signal,
      agentPid: null,
    },
    'status_changed',
    finalStatus,
  );

  // Write final result to session workspace
  if (currentTaskSnapshot?.workspacePath) {
    try {
      await appendToWorkspace(currentTaskSnapshot.workspacePath, {
        agentLabel: currentTaskSnapshot.label || currentTaskSnapshot.id,
        type: finalStatus === 'completed' ? 'result' : 'error',
        content:
          finalStatus === 'completed'
            ? `Task completed successfully (exit code ${code}).`
            : `Task ${finalStatus} (exit code: ${code}, signal: ${signal || 'none'}).${currentTaskSnapshot.error ? ' Error: ' + currentTaskSnapshot.error : ''}`,
      });
    } catch {
      /* non-fatal */
    }
  }
}

process.on('SIGTERM', () => {
  if (child?.pid) {
    child.kill('SIGTERM');
  }
});

process.on('SIGINT', () => {
  if (child?.pid) {
    child.kill('SIGINT');
  }
});

main()
  .catch(async (error) => {
    const existing = (await pathExists(taskFile)) ? await readJson(taskFile) : null;
    if (existing) {
      currentTaskSnapshot = existing;
      db = db || openDb(existing.stateRoot);
      const failedTask = {
        ...existing,
        status: 'failed',
        updatedAt: nowIso(),
        completedAt: nowIso(),
        error: error.message,
      };
      await writeJsonAtomic(taskFile, failedTask);
      upsertTask(db, failedTask);
      writeEvent('system', 'runner_error', error.stack || error.message, {});
      await fsPromises.appendFile(existing.logs.runnerStderr, `${nowIso()} ${error.stack || error.message}\n`, 'utf8');
    }
    process.exitCode = 1;
  })
  .finally(() => {
    db?.close?.();
  });
