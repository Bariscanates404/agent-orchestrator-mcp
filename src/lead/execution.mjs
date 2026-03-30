import { insertLeadRunEvent, listLeadRunItems, upsertLeadRunItem } from '../db/index.mjs';
import { appendToWorkspace, shortenText } from '../lib/index.mjs';
import { TASK_TERMINAL_STATES } from '../shared/constants.mjs';
import { unwrapToolResult } from '../shared/mcp-result.mjs';
import { nowIso } from '../shared/time.mjs';
import { waitWhilePaused } from './pause.mjs';
import { composeWorkerPrompt } from './prompts.mjs';

function updateItem(db, item, patch) {
  const merged = {
    ...item,
    ...patch,
    updatedAt: nowIso(),
  };
  upsertLeadRunItem(db, merged);
  return merged;
}

export async function launchWorkerAndWaitForResult(clientContext, run, prompt, label, pollMs, timeoutMs) {
  const launch = await clientContext.client.callTool({
    name: 'launch_agent_task',
    arguments: {
      backend: run.leadBackend || 'claude',
      label,
      task: prompt,
      worktreeMode: 'reuse_repo',
      effort: 'high',
    },
  });

  const launched = unwrapToolResult(launch);
  const taskId = launched.id;
  const startTime = Date.now();

  while (true) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`Worker task ${taskId} timed out after ${timeoutMs / 1000}s`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));

    const response = await clientContext.client.callTool({
      name: 'get_agent_task',
      arguments: { taskId },
    });
    const payload = unwrapToolResult(response);
    const workerTask = payload.task;

    if (TASK_TERMINAL_STATES.has(workerTask.status)) {
      const resultText = payload.summary?.agentResult || '';
      if (workerTask.status !== 'completed') {
        throw new Error(
          `Worker task ${taskId} ended with status ${workerTask.status}: ${workerTask.error || 'unknown error'}`,
        );
      }
      return { taskId, resultText };
    }
  }
}

export async function executeItems(db, clientContext, run, rulesDoc, runId, repoRoot, pollMs, wsPath) {
  const items = listLeadRunItems(db, runId);
  const pending = items
    .filter((item) => item.status === 'pending' || item.status === 'queued')
    .map((item) => ({ ...item, retry: null }));
  const active = new Map();

  async function launchOne(job) {
    const round = job.round || 1;
    const prompt = composeWorkerPrompt({
      run,
      item: job,
      rulesText: rulesDoc?.text || null,
      round,
      previousOutcome: job.retry,
      wsPath,
    });

    const launch = await clientContext.client.callTool({
      name: 'launch_agent_task',
      arguments: {
        backend: run.workerBackend || 'claude',
        fallbackBackend: run.workerBackend === 'codex' ? 'claude' : undefined,
        label: `${run.label}-item-${job.taskIndex + 1}-r${round}`,
        task: prompt,
        worktreeMode: 'reuse_repo',
        effort: 'medium',
      },
    });

    const launched = unwrapToolResult(launch);
    const launchedTaskId = launched.id;

    const updatedItem = updateItem(db, job, {
      status: 'running',
      workerTaskId: launchedTaskId,
      round,
      error: null,
    });

    insertLeadRunEvent(db, {
      runId,
      repoRoot,
      eventType: 'item_launched',
      content: `Item ${job.taskIndex + 1} launched as worker task ${launchedTaskId}.`,
      metadata: {
        taskIndex: job.taskIndex,
        round,
        workerTaskId: launchedTaskId,
        backend: run.workerBackend,
      },
    });

    active.set(updatedItem.taskIndex, updatedItem);
  }

  const maxParallel = run.maxParallel || 3;
  const LAUNCH_STAGGER_MS = 2000; // 2s gap between launches to avoid API rate spikes
  let waveNumber = 0;

  while (pending.length > 0 || active.size > 0) {
    await waitWhilePaused(db, runId, pollMs);

    // Launch a wave of tasks up to maxParallel slots
    const launchedThisWave = [];
    while (pending.length > 0 && active.size < maxParallel) {
      const next = pending.shift();
      await launchOne(next);
      launchedThisWave.push(next.label || `item-${next.taskIndex + 1}`);
      // Stagger launches to prevent API rate spikes
      if (pending.length > 0 && active.size < maxParallel) {
        await new Promise((resolve) => setTimeout(resolve, LAUNCH_STAGGER_MS));
      }
    }

    // Log wave info
    if (launchedThisWave.length > 0) {
      waveNumber++;
      insertLeadRunEvent(db, {
        runId,
        repoRoot,
        eventType: 'execution_wave',
        content: `Dalga ${waveNumber}: ${launchedThisWave.length} isci baslatildi (toplam aktif: ${active.size}).`,
        metadata: {
          wave: waveNumber,
          launched: launchedThisWave.length,
          activeCount: active.size,
          pendingCount: pending.length,
          labels: launchedThisWave,
        },
      });
    }

    for (const [taskIndex, runningItem] of [...active.entries()]) {
      const response = await clientContext.client.callTool({
        name: 'get_agent_task',
        arguments: { taskId: runningItem.workerTaskId },
      });
      const payload = unwrapToolResult(response);
      const workerTask = payload.task;
      const summary = payload.summary || {};

      if (!TASK_TERMINAL_STATES.has(workerTask.status)) {
        continue;
      }

      active.delete(taskIndex);

      const resultText = summary.agentResult || '';
      const errorText =
        workerTask.error ||
        (workerTask.status === 'completed' ? null : `Worker task ended with status ${workerTask.status}`);
      const finalized = updateItem(db, runningItem, {
        status: workerTask.status,
        completedAt: nowIso(),
        resultText: resultText || null,
        error: errorText,
      });

      insertLeadRunEvent(db, {
        runId,
        repoRoot,
        eventType: 'item_finished',
        content: `Item ${taskIndex + 1} finished with status ${workerTask.status}.`,
        metadata: {
          taskIndex,
          workerTaskId: runningItem.workerTaskId,
          status: workerTask.status,
          round: finalized.round,
          resultSnippet: shortenText(resultText || '', 260),
          error: errorText,
        },
      });

      if (wsPath) {
        await appendToWorkspace(wsPath, {
          agentLabel: runningItem.label || `item-${taskIndex + 1}`,
          type: workerTask.status === 'completed' ? 'result' : 'error',
          content: resultText || errorText || '',
        });
      }

      if (workerTask.status !== 'completed' && finalized.round < (run.maxRounds || 2)) {
        const retryItem = updateItem(db, finalized, {
          status: 'queued',
          round: finalized.round + 1,
          workerTaskId: null,
        });
        pending.push({
          ...retryItem,
          retry: {
            status: workerTask.status,
            error: errorText,
            resultText,
          },
        });
        insertLeadRunEvent(db, {
          runId,
          repoRoot,
          eventType: 'item_retry_queued',
          content: `Item ${taskIndex + 1} queued for retry round ${retryItem.round}.`,
          metadata: {
            taskIndex,
            nextRound: retryItem.round,
          },
        });
      }
    }

    if (pending.length > 0 || active.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}
