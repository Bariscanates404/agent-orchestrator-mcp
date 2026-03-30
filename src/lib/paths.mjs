import os from 'node:os';
import path from 'node:path';
import { repoSlug } from './ids.mjs';

export const DEFAULT_STATE_ROOT = path.join(os.homedir(), '.codex', 'agent-orchestrator');

export function resolveRepoRoot() {
  return path.resolve(process.env.TEAMLEAD_REPO_ROOT || process.cwd());
}

export function resolveStateRoot() {
  return path.resolve(process.env.TEAMLEAD_STATE_ROOT || DEFAULT_STATE_ROOT);
}

export function getRepoStatePaths(repoRoot = resolveRepoRoot(), stateRoot = resolveStateRoot()) {
  const slug = repoSlug(repoRoot);
  const baseDir = path.join(stateRoot, slug);
  return {
    repoRoot,
    stateRoot,
    slug,
    baseDir,
    tasksDir: path.join(baseDir, 'tasks'),
    worktreesDir: path.join(baseDir, 'worktrees'),
    reportsDir: path.join(baseDir, 'reports'),
  };
}

export function taskFilePath(taskId, repoRoot = resolveRepoRoot(), stateRoot = resolveStateRoot()) {
  return path.join(getRepoStatePaths(repoRoot, stateRoot).tasksDir, `${taskId}.json`);
}

export function buildTaskPaths(taskId, repoRoot = resolveRepoRoot(), stateRoot = resolveStateRoot()) {
  const dirs = getRepoStatePaths(repoRoot, stateRoot);
  return {
    taskFile: path.join(dirs.tasksDir, `${taskId}.json`),
    stdout: path.join(dirs.tasksDir, `${taskId}.stdout.log`),
    stderr: path.join(dirs.tasksDir, `${taskId}.stderr.log`),
    runnerStdout: path.join(dirs.tasksDir, `${taskId}.runner.stdout.log`),
    runnerStderr: path.join(dirs.tasksDir, `${taskId}.runner.stderr.log`),
    worktreePath: path.join(dirs.worktreesDir, taskId),
  };
}
