import { pathExists, readJson, readTail } from './fs.mjs';
import { gitCommand } from './git.mjs';
import { parseClaudeResult, parseCodexResult } from './parse-output.mjs';
import { getRepoStatePaths } from './paths.mjs';
import { shortenText } from './text.mjs';

export async function getTaskSummary(task) {
  const stdoutLines = await readTail(task.logs.stdout, 200);
  const stderrLines = await readTail(task.logs.stderr, 80);
  const runnerStderrLines = await readTail(task.logs.runnerStderr, 80);
  const agentResult = task.backend === 'claude' ? parseClaudeResult(stdoutLines) : parseCodexResult(stdoutLines);

  const summary = {
    stdoutTail: stdoutLines.slice(-60),
    stderrTail: stderrLines.slice(-40),
    runnerStderrTail: runnerStderrLines.slice(-40),
    agentResult,
    git: null,
  };

  if (task.worktree?.mode === 'git_worktree' && task.worktree?.path && (await pathExists(task.worktree.path))) {
    const [status, diff, head] = await Promise.all([
      gitCommand(task.worktree.path, ['status', '--short']),
      gitCommand(task.worktree.path, ['diff', '--stat', 'HEAD']),
      gitCommand(task.worktree.path, ['log', '--oneline', '--decorate', '-1']),
    ]);
    summary.git = {
      status: status.ok ? status.stdout.trim().split('\n').filter(Boolean).slice(0, 100) : [],
      diffStat: diff.ok ? diff.stdout.trim().split('\n').filter(Boolean).slice(0, 100) : [],
      head: head.ok ? head.stdout.trim() : null,
    };
  }

  return summary;
}

export async function listStoredTasks(repoRoot, stateRoot, options = {}) {
  const dirs = getRepoStatePaths(repoRoot, stateRoot);
  if (!(await pathExists(dirs.tasksDir))) {
    return [];
  }

  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const entries = (await fs.readdir(dirs.tasksDir))
    .filter((entry) => entry.endsWith('.json'))
    .sort()
    .reverse();

  const tasks = [];
  for (const entry of entries) {
    const task = await readJson(path.join(dirs.tasksDir, entry));
    if (!options.status || task.status === options.status) {
      tasks.push(task);
    }
    if (options.limit && tasks.length >= options.limit) {
      break;
    }
  }
  return tasks;
}

export async function buildDashboardState(repoRoot, stateRoot, options = {}) {
  const allTasks = await listStoredTasks(repoRoot, stateRoot, options.status ? { status: options.status } : {});
  const counts = allTasks.reduce((acc, task) => {
    acc[task.status] = (acc[task.status] || 0) + 1;
    return acc;
  }, {});

  const recentTasks = await Promise.all(
    allTasks.slice(0, options.limit || 20).map(async (task) => {
      const summary = await getTaskSummary(task);
      return {
        id: task.id,
        label: task.label,
        backend: task.backend,
        requestedBackend: task.requestedBackend || task.backend,
        fallbackUsed: Boolean(task.fallbackUsed),
        status: task.status,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        completedAt: task.completedAt,
        promptSummary: task.promptSummary,
        worktreeMode: task.worktree?.mode || null,
        worktreePath: task.worktree?.path || null,
        resultSnippet: shortenText(summary.agentResult || ''),
        hasStdout: summary.stdoutTail.length > 0,
        hasStderr: summary.stderrTail.length > 0,
        git: summary.git,
      };
    }),
  );

  return {
    generatedAt: new Date().toISOString(),
    repoRoot,
    stateRoot,
    counts,
    totalTasks: allTasks.length,
    recentTasks,
  };
}
