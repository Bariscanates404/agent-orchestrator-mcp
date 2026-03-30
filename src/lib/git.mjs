import { runCommand } from './process.mjs';

export async function gitCommand(repoRoot, args) {
  return runCommand('git', args, { cwd: repoRoot });
}

export async function getGitOverview(repoRoot) {
  const [status, branch, head] = await Promise.all([
    gitCommand(repoRoot, ['status', '--porcelain']),
    gitCommand(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']),
    gitCommand(repoRoot, ['rev-parse', 'HEAD']),
  ]);

  return {
    repoRoot,
    branch: branch.ok ? branch.stdout.trim() : null,
    head: head.ok ? head.stdout.trim() : null,
    isDirty: status.ok ? status.stdout.trim().length > 0 : null,
    statusSample: status.ok ? status.stdout.trim().split('\n').filter(Boolean).slice(0, 20) : [],
  };
}
