import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeOrchestratorClient, connectOrchestratorClient } from '../client/index.mjs';
import { getSettings, openDb, updateSettings } from '../db/index.mjs';
import { getRepoStatePaths, resolveRepoRoot, resolveStateRoot, writeJsonAtomic } from '../lib/index.mjs';
import { nowIso } from '../shared/time.mjs';

export async function runClaudeDemoBatch(options = {}) {
  const repoRoot = options.repoRoot || resolveRepoRoot();
  const stateRoot = options.stateRoot || resolveStateRoot();
  const db = openDb(stateRoot);
  try {
    updateSettings(db, {
      leadBackend: options.leadBackend || getSettings(db).leadBackend || 'codex',
      defaultWorkerBackend: 'claude',
      codexFallbackBackend: 'claude',
    });
  } finally {
    db.close();
  }

  const context = await connectOrchestratorClient({
    repoRoot,
    stateRoot,
    clientName: 'agent-orchestrator-demo',
  });

  try {
    const tasks = [
      {
        label: 'demo-mcp-audit',
        worktreeMode: 'reuse_repo',
        fallbackBackend: 'claude',
        effort: 'low',
        task: [
          'Read-only audit only. Do not edit files.',
          'Inspect the orchestrator MCP tool surface and summarize the highest-value missing operator capability.',
          'Focus on server.mjs, watcher-server.mjs, and README.',
          'Reply with exactly 3 sections: Verdict, Missing Capability, Next Step.',
        ].join(' '),
      },
      {
        label: 'demo-schema-audit',
        worktreeMode: 'reuse_repo',
        fallbackBackend: 'claude',
        effort: 'low',
        task: [
          'Read-only audit only. Do not edit files.',
          'Inspect db.mjs and runner.mjs and summarize the main observability or durability gap in task persistence.',
          'Reply with exactly 3 sections: Verdict, Weakest Link, Next Step.',
        ].join(' '),
      },
      {
        label: 'demo-watcher-audit',
        worktreeMode: 'reuse_repo',
        fallbackBackend: 'claude',
        effort: 'low',
        task: [
          'Read-only audit only. Do not edit files.',
          'Inspect public/index.html and watcher-server.mjs and summarize what the local watcher UI should track first.',
          'Reply with exactly 3 sections: Verdict, Must Track, Next Step.',
        ].join(' '),
      },
    ];

    const launch = await context.client.callTool({
      name: 'launch_agent_batch',
      arguments: { tasks },
    });

    const launchedTasks = launch.structuredContent.tasks;
    const deadline = Date.now() + (options.timeoutMs || 180000);
    const results = [];

    for (const entry of launchedTasks) {
      let current = null;
      while (Date.now() < deadline) {
        const response = await context.client.callTool({
          name: 'get_agent_task',
          arguments: { taskId: entry.id },
        });
        current = response.structuredContent;
        if (['completed', 'failed', 'cancelled'].includes(current.task.status)) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      results.push({
        id: current?.task?.id || entry.id,
        label: current?.task?.label || entry.label,
        requestedBackend: current?.task?.requestedBackend || 'claude',
        backend: current?.task?.backend || entry.backend || 'claude',
        fallbackUsed: Boolean(current?.task?.fallbackUsed),
        status: current?.task?.status || 'unknown',
        result: current?.summary?.agentResult || null,
        stderrTail: current?.summary?.stderrTail || [],
      });
    }

    const report = {
      generatedAt: nowIso(),
      repoRoot,
      stateRoot,
      mode: 'claude-demo-batch',
      taskCount: results.length,
      results,
    };

    const reportPath = path.join(
      getRepoStatePaths(repoRoot, stateRoot).reportsDir,
      `claude-demo-batch-${Date.now()}.json`,
    );
    await writeJsonAtomic(reportPath, report);
    return { reportPath, report };
  } finally {
    await closeOrchestratorClient(context);
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  const result = await runClaudeDemoBatch();
  console.log(JSON.stringify(result, null, 2));
}
