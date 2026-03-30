import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { gitCommand } from '../lib/index.mjs';

export async function prepareWorktree(task) {
  if (task.worktree.mode !== 'git_worktree') {
    return {
      path: task.repoRoot,
      branch: null,
      created: false,
    };
  }

  const status = await gitCommand(task.repoRoot, ['status', '--porcelain']);
  if (!status.ok) {
    throw new Error(`git status failed: ${status.stderr || status.stdout}`);
  }
  if (status.stdout.trim() && !task.allowDirtyBase) {
    throw new Error(
      'Repository has uncommitted changes. Commit or stash before launching isolated worktree tasks, or set allowDirtyBase=true for read-only experiments.',
    );
  }

  await fsPromises.mkdir(path.dirname(task.worktree.path), { recursive: true });
  const branch = task.worktree.branch;
  const worktreeAdd = await gitCommand(task.repoRoot, [
    'worktree',
    'add',
    '-b',
    branch,
    task.worktree.path,
    task.baseRef || 'HEAD',
  ]);
  if (!worktreeAdd.ok) {
    throw new Error(`git worktree add failed: ${worktreeAdd.stderr || worktreeAdd.stdout}`);
  }

  return {
    path: task.worktree.path,
    branch,
    created: true,
  };
}
