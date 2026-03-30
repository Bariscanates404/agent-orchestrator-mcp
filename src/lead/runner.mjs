import fs from 'node:fs/promises';
import path from 'node:path';
import { closeOrchestratorClient, connectOrchestratorClient } from '../client/index.mjs';
import {
  getLeadRunById,
  getNextItemTaskIndex,
  insertLeadRunEvent,
  listLeadRunItems,
  openDb,
  upsertLeadRun,
  upsertLeadRunItem,
} from '../db/index.mjs';
import { pathExists, resolveRepoRoot, resolveStateRoot } from '../lib/index.mjs';
import { parseJsonFromWorkerOutput } from '../lib/parse-output.mjs';
import { nowIso } from '../shared/time.mjs';
import { executeItems, launchWorkerAndWaitForResult } from './execution.mjs';
import { composeEvaluatorPrompt, composePlannerPrompt } from './prompts.mjs';

const runId = process.argv[2];
if (!runId) {
  throw new Error('lead-runner requires runId argument');
}

const repoRoot = resolveRepoRoot();
const stateRoot = resolveStateRoot();
const pollMs = Number(process.env.LEAD_RUN_POLL_MS || 2000);
const WORKER_TIMEOUT_MS = Number(process.env.LEAD_WORKER_TIMEOUT_MS || 600_000);

function updateRun(db, run, patch) {
  const merged = {
    ...run,
    ...patch,
    updatedAt: nowIso(),
  };
  upsertLeadRun(db, merged);
  return merged;
}

async function loadRulesDoc(run) {
  const candidates = [];
  if (run.rulesDocPath) {
    candidates.push(run.rulesDocPath);
  }
  candidates.push(path.join(repoRoot, 'CLAUDE.md'));

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (await pathExists(candidate)) {
      const text = await fs.readFile(candidate, 'utf8');
      return {
        path: candidate,
        text: text.trim(),
      };
    }
  }
  return null;
}

async function main() {
  const db = openDb(stateRoot);
  const clientContext = await connectOrchestratorClient({
    repoRoot,
    stateRoot,
    clientName: `lead-runner-${runId}`,
  });

  try {
    let run = getLeadRunById(db, runId);
    if (!run) {
      throw new Error(`Lead run not found: ${runId}`);
    }

    const rulesDoc = await loadRulesDoc(run);
    run = updateRun(db, run, {
      startedAt: run.startedAt || nowIso(),
      rulesDocPath: rulesDoc?.path || run.rulesDocPath || null,
      rulesDocUsed: Boolean(rulesDoc?.text),
      error: null,
    });

    insertLeadRunEvent(db, {
      runId,
      repoRoot,
      eventType: 'run_started',
      content: `Lead run started by ${run.leadBackend}.`,
      metadata: {
        leadBackend: run.leadBackend,
        workerBackend: run.workerBackend,
        maxParallel: run.maxParallel,
        maxRounds: run.maxRounds,
        maxEvalRounds: run.maxEvalRounds,
        rulesDocPath: run.rulesDocPath,
      },
    });

    // PHASE 1: PLANNING — generate subtasks if none exist
    let items = listLeadRunItems(db, runId);

    if (items.length === 0) {
      run = updateRun(db, run, { status: 'planning', phase: 'planning' });
      insertLeadRunEvent(db, {
        runId,
        repoRoot,
        eventType: 'planning_started',
        content: 'Planning phase started. Generating subtasks from objective.',
      });

      const plannerPrompt = composePlannerPrompt(run, rulesDoc?.text || null);
      const plannerResult = await launchWorkerAndWaitForResult(
        clientContext,
        run,
        plannerPrompt,
        `${run.label}-planner`,
        pollMs,
        WORKER_TIMEOUT_MS,
      );

      run = updateRun(db, run, { planningTaskId: plannerResult.taskId });

      const subtasks = parseJsonFromWorkerOutput(plannerResult.resultText);
      if (!Array.isArray(subtasks) || subtasks.length === 0) {
        throw new Error('Planner returned empty or non-array result');
      }

      for (let i = 0; i < subtasks.length; i++) {
        const sub = subtasks[i];
        if (!sub.instruction || typeof sub.instruction !== 'string') {
          throw new Error(`Planner subtask ${i} missing valid "instruction" field`);
        }
        upsertLeadRunItem(db, {
          runId,
          taskIndex: i,
          label: sub.label || `subtask-${i + 1}`,
          instruction: sub.instruction,
          status: 'pending',
          round: 1,
        });
      }

      insertLeadRunEvent(db, {
        runId,
        repoRoot,
        eventType: 'planning_completed',
        content: `Planning phase completed. ${subtasks.length} subtasks created.`,
        metadata: {
          subtaskCount: subtasks.length,
          planningTaskId: plannerResult.taskId,
          labels: subtasks.map((s) => s.label || 'unlabeled'),
        },
      });

      items = listLeadRunItems(db, runId);
    }

    if (items.length === 0) {
      throw new Error('Lead run has no subtask items after planning phase.');
    }

    // PHASE 2 + 3 LOOP: EXECUTION → EVALUATION (with retry)
    let evalRound = run.evaluationRound || 0;
    const maxEvalRounds = run.maxEvalRounds ?? 2;

    while (true) {
      // PHASE 2: EXECUTION
      run = updateRun(db, run, { status: 'running', phase: 'executing' });
      insertLeadRunEvent(db, {
        runId,
        repoRoot,
        eventType: 'execution_started',
        content: `Execution phase started (eval round ${evalRound}).`,
        metadata: { evaluationRound: evalRound },
      });

      await executeItems(db, clientContext, run, rulesDoc, runId, repoRoot, pollMs);

      items = listLeadRunItems(db, runId);
      const completedCount = items.filter((item) => item.status === 'completed').length;
      const failedCount = items.filter((item) => item.status !== 'completed').length;

      insertLeadRunEvent(db, {
        runId,
        repoRoot,
        eventType: 'execution_completed',
        content: `Execution phase completed: ${completedCount} done, ${failedCount} not completed.`,
        metadata: { completed: completedCount, failed: failedCount, total: items.length },
      });

      if (completedCount === 0 && failedCount > 0) {
        run = updateRun(db, run, {
          status: 'failed',
          completedAt: nowIso(),
          resultSummary: `All ${items.length} items failed.`,
          error: 'All subtask items failed.',
        });
        insertLeadRunEvent(db, {
          runId,
          repoRoot,
          eventType: 'run_finished',
          content: `Lead run failed: all ${items.length} items failed.`,
          metadata: { status: 'failed', completed: 0, failed: failedCount, total: items.length },
        });
        return;
      }

      if (evalRound >= maxEvalRounds) {
        const finalStatus = failedCount > 0 ? 'failed' : 'completed';
        const resultSummary = `Lead run finished (max eval rounds reached): completed=${completedCount}, failed=${failedCount}`;
        run = updateRun(db, run, {
          status: finalStatus,
          completedAt: nowIso(),
          resultSummary,
          error: failedCount > 0 ? 'Some items did not complete. Max evaluation rounds reached.' : null,
        });
        insertLeadRunEvent(db, {
          runId,
          repoRoot,
          eventType: 'run_finished',
          content: resultSummary,
          metadata: {
            status: finalStatus,
            completed: completedCount,
            failed: failedCount,
            total: items.length,
            evalRound,
          },
        });
        return;
      }

      // PHASE 3: EVALUATION
      evalRound++;
      run = updateRun(db, run, { status: 'evaluating', phase: 'evaluating', evaluationRound: evalRound });
      insertLeadRunEvent(db, {
        runId,
        repoRoot,
        eventType: 'evaluation_started',
        content: `Evaluation phase started (round ${evalRound}/${maxEvalRounds}).`,
        metadata: { evaluationRound: evalRound, maxEvalRounds },
      });

      const evalPrompt = composeEvaluatorPrompt(run, items, rulesDoc?.text || null);
      const evalResult = await launchWorkerAndWaitForResult(
        clientContext,
        run,
        evalPrompt,
        `${run.label}-evaluator-r${evalRound}`,
        pollMs,
        WORKER_TIMEOUT_MS,
      );

      run = updateRun(db, run, { evaluationTaskId: evalResult.taskId });

      const verdict = parseJsonFromWorkerOutput(evalResult.resultText);
      const verdictType = (verdict.verdict || '').toLowerCase();

      insertLeadRunEvent(db, {
        runId,
        repoRoot,
        eventType: 'evaluation_verdict',
        content: `Evaluation verdict: ${verdictType} — ${verdict.reason || 'no reason given'}`,
        metadata: {
          verdict: verdictType,
          reason: verdict.reason,
          evaluationRound: evalRound,
          evaluationTaskId: evalResult.taskId,
          followUpCount: verdict.followUpTasks?.length || 0,
        },
      });

      if (verdictType === 'pass') {
        const resultSummary = `Lead run passed evaluation: ${verdict.reason || 'objective met'}`;
        run = updateRun(db, run, {
          status: 'completed',
          phase: 'completed',
          completedAt: nowIso(),
          resultSummary,
          error: null,
        });
        insertLeadRunEvent(db, {
          runId,
          repoRoot,
          eventType: 'run_finished',
          content: resultSummary,
          metadata: { status: 'completed', evalRound, verdict: verdictType },
        });
        return;
      }

      if (verdictType === 'fail') {
        const resultSummary = `Lead run failed evaluation: ${verdict.reason || 'objective cannot be met'}`;
        run = updateRun(db, run, {
          status: 'failed',
          phase: 'failed',
          completedAt: nowIso(),
          resultSummary,
          error: verdict.reason || 'Evaluator returned fail verdict.',
        });
        insertLeadRunEvent(db, {
          runId,
          repoRoot,
          eventType: 'run_finished',
          content: resultSummary,
          metadata: { status: 'failed', evalRound, verdict: verdictType },
        });
        return;
      }

      // verdict === 'retry': add follow-up tasks and loop back to execution
      if (Array.isArray(verdict.followUpTasks) && verdict.followUpTasks.length > 0) {
        const baseIndex = getNextItemTaskIndex(db, runId);
        for (let i = 0; i < verdict.followUpTasks.length; i++) {
          const ft = verdict.followUpTasks[i];
          upsertLeadRunItem(db, {
            runId,
            taskIndex: baseIndex + i,
            label: ft.label || `followup-r${evalRound}-${i + 1}`,
            instruction: ft.instruction || ft.task || String(ft),
            status: 'pending',
            round: 1,
          });
        }
        insertLeadRunEvent(db, {
          runId,
          repoRoot,
          eventType: 'followup_items_created',
          content: `${verdict.followUpTasks.length} follow-up items created for retry.`,
          metadata: {
            evaluationRound: evalRound,
            newItemCount: verdict.followUpTasks.length,
            startIndex: baseIndex,
          },
        });
      }
    }
  } catch (error) {
    const dbForError = openDb(stateRoot);
    try {
      const run = getLeadRunById(dbForError, runId);
      if (run) {
        upsertLeadRun(dbForError, {
          ...run,
          status: 'failed',
          updatedAt: nowIso(),
          completedAt: nowIso(),
          error: error.message || String(error),
        });
        insertLeadRunEvent(dbForError, {
          runId,
          repoRoot,
          eventType: 'run_failed',
          content: error.message || String(error),
          metadata: {
            stack: error.stack || null,
          },
        });
      }
    } finally {
      dbForError.close();
    }
    throw error;
  } finally {
    await closeOrchestratorClient(clientContext);
    db.close();
  }
}

await main();
