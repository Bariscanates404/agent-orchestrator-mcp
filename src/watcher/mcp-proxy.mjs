import { closeOrchestratorClient, connectOrchestratorClient } from '../client/index.mjs';
import { unwrapToolResult } from '../shared/mcp-result.mjs';

export async function withOrchestratorClient(repoRoot, stateRoot, callback) {
  const context = await connectOrchestratorClient({
    repoRoot,
    stateRoot,
    clientName: 'agent-orchestrator-watcher',
  });
  try {
    return await callback(context.client);
  } finally {
    await closeOrchestratorClient(context);
  }
}

export async function launchTasks(repoRoot, stateRoot, tasks) {
  return withOrchestratorClient(repoRoot, stateRoot, async (client) => {
    const result = await client.callTool({
      name: 'launch_agent_batch',
      arguments: { tasks },
    });
    return unwrapToolResult(result);
  });
}

export async function escalateTask(repoRoot, stateRoot, taskId, body = {}) {
  return withOrchestratorClient(repoRoot, stateRoot, async (client) => {
    const result = await client.callTool({
      name: 'escalate_agent_task',
      arguments: {
        taskId,
        backend: body.backend,
        fallbackBackend: body.fallbackBackend,
        reason: body.reason,
        label: body.label,
        worktreeMode: body.worktreeMode,
        allowDirtyBase: body.allowDirtyBase,
        baseRef: body.baseRef,
        model: body.model,
        effort: body.effort,
        profile: body.profile,
        branchName: body.branchName,
        systemPrompt: body.systemPrompt,
        additionalArgs: body.additionalArgs,
      },
    });
    return unwrapToolResult(result);
  });
}

export async function cancelTask(repoRoot, stateRoot, taskId) {
  return withOrchestratorClient(repoRoot, stateRoot, async (client) => {
    const result = await client.callTool({
      name: 'cancel_agent_task',
      arguments: { taskId },
    });
    return unwrapToolResult(result);
  });
}

export async function cleanupTask(repoRoot, stateRoot, taskId, deleteBranch = false) {
  return withOrchestratorClient(repoRoot, stateRoot, async (client) => {
    const result = await client.callTool({
      name: 'cleanup_agent_task',
      arguments: { taskId, deleteBranch },
    });
    return unwrapToolResult(result);
  });
}

export async function createLeadRun(repoRoot, stateRoot, body) {
  return withOrchestratorClient(repoRoot, stateRoot, async (client) => {
    const result = await client.callTool({
      name: 'create_lead_run',
      arguments: {
        objective: body.objective,
        label: body.label || undefined,
        workerBackend: body.workerBackend || undefined,
        leadBackend: body.leadBackend || undefined,
        maxParallel: body.maxParallel || undefined,
        maxRounds: body.maxRounds || undefined,
        maxEvalRounds: body.maxEvalRounds || undefined,
        rulesDocPath: body.rulesDocPath || undefined,
        items: body.items || undefined,
      },
    });
    return unwrapToolResult(result);
  });
}

export async function pauseLeadRun(repoRoot, stateRoot, runId) {
  return withOrchestratorClient(repoRoot, stateRoot, async (client) => {
    const result = await client.callTool({
      name: 'pause_lead_run',
      arguments: { runId },
    });
    return unwrapToolResult(result);
  });
}

export async function resumeLeadRun(repoRoot, stateRoot, runId) {
  return withOrchestratorClient(repoRoot, stateRoot, async (client) => {
    const result = await client.callTool({
      name: 'resume_lead_run',
      arguments: { runId },
    });
    return unwrapToolResult(result);
  });
}

export async function cancelLeadRun(repoRoot, stateRoot, runId) {
  return withOrchestratorClient(repoRoot, stateRoot, async (client) => {
    const result = await client.callTool({
      name: 'cancel_lead_run',
      arguments: { runId },
    });
    return unwrapToolResult(result);
  });
}

export async function addLeadRunItem(repoRoot, stateRoot, runId, body) {
  return withOrchestratorClient(repoRoot, stateRoot, async (client) => {
    const result = await client.callTool({
      name: 'add_lead_run_item',
      arguments: {
        runId,
        instruction: body.instruction,
        label: body.label || undefined,
      },
    });
    return unwrapToolResult(result);
  });
}

export async function continueLeadRun(repoRoot, stateRoot, runId, body = {}) {
  return withOrchestratorClient(repoRoot, stateRoot, async (client) => {
    const result = await client.callTool({
      name: 'continue_lead_run',
      arguments: {
        runId,
        objective: body.objective || undefined,
        items: body.items || undefined,
      },
    });
    return unwrapToolResult(result);
  });
}
