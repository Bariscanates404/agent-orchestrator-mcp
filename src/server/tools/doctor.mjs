import { z } from 'zod';
import { discoverBackends, getGitOverview, getRepoStatePaths } from '../../lib/index.mjs';
import { toTextResult } from '../../shared/mcp-result.mjs';
import { getRuntimeSettings } from '../../shared/settings.mjs';

export function registerDoctorTool(server, { repoRoot, stateRoot }) {
  server.registerTool(
    'orchestrator_doctor',
    {
      description: 'Inspect backend availability, repo cleanliness, and state directories for the agent orchestrator.',
      inputSchema: z.object({}).strict(),
    },
    async () => {
      const [backends, git] = await Promise.all([discoverBackends(), getGitOverview(repoRoot)]);
      const state = getRepoStatePaths(repoRoot, stateRoot);
      const runtimeSettings = getRuntimeSettings(stateRoot);
      return toTextResult('orchestrator_doctor', {
        repoRoot,
        stateRoot,
        leadBackend: runtimeSettings.leadBackend,
        defaultWorkerBackend: runtimeSettings.defaultWorkerBackend,
        codexFallbackBackend: runtimeSettings.codexFallbackBackend,
        tasksDir: state.tasksDir,
        worktreesDir: state.worktreesDir,
        reportsDir: state.reportsDir,
        git,
        backends,
      });
    },
  );
}
