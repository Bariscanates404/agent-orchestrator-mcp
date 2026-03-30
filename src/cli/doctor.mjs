import {
  discoverBackends,
  ensureRepoStatePaths,
  getGitOverview,
  resolveRepoRoot,
  resolveStateRoot,
} from '../lib/index.mjs';

const repoRoot = resolveRepoRoot();
const stateRoot = resolveStateRoot();
const [dirs, backends, git] = await Promise.all([
  ensureRepoStatePaths(repoRoot, stateRoot),
  discoverBackends(),
  getGitOverview(repoRoot),
]);

console.log(
  JSON.stringify(
    {
      repoRoot,
      stateRoot,
      dirs,
      git,
      backends,
    },
    null,
    2,
  ),
);
