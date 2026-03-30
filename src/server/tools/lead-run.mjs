import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  getLeadRunById,
  insertLeadRunEvent,
  listLeadRunEvents,
  listLeadRunItems,
  listLeadRunsForRepo,
  openDb,
  upsertLeadRun,
  upsertLeadRunItem,
} from '../../db/index.mjs';
import { makeTaskId, shortenText } from '../../lib/index.mjs';
import { toTextResult } from '../../shared/mcp-result.mjs';
import { getRuntimeSettings } from '../../shared/settings.mjs';
import { spawnDetached } from '../../shared/spawn-detached.mjs';
import { nowIso } from '../../shared/time.mjs';

export function registerLeadRunTools(server, { repoRoot, stateRoot, leadRunnerPath }) {
  server.registerTool(
    'create_lead_run',
    {
      description:
        'Create and launch a lead run that autonomously plans subtasks, executes them in parallel, and evaluates results. Provide an objective and the system handles everything.',
      inputSchema: z
        .object({
          objective: z.string().min(1).describe('High-level goal the lead agent should achieve'),
          label: z.string().min(1).optional().describe('Short human-readable label for the run'),
          workerBackend: z.enum(['claude', 'codex']).optional().describe('Backend for worker subtasks'),
          leadBackend: z.enum(['claude', 'codex']).optional().describe('Backend for planning/evaluation'),
          maxParallel: z.number().int().min(1).max(12).optional().describe('Max concurrent worker tasks'),
          maxRounds: z.number().int().min(1).max(5).optional().describe('Max retry rounds per item'),
          maxEvalRounds: z.number().int().min(0).max(5).optional().describe('Max evaluation-retry cycles'),
          rulesDocPath: z.string().optional().describe('Path to CLAUDE.md or custom rules file'),
          items: z
            .array(
              z.object({
                label: z.string().optional(),
                instruction: z.string().min(1),
              }),
            )
            .optional()
            .describe('Pre-defined subtasks (skips planning phase if provided)'),
        })
        .strict(),
    },
    async (input) => {
      const runtimeSettings = getRuntimeSettings(stateRoot);
      const runLabel = input.label || `lead-${Date.now().toString(36)}`;
      const runIdValue = makeTaskId(runLabel);
      const now = nowIso();

      const run = {
        id: runIdValue,
        repoRoot,
        stateRoot,
        label: runLabel,
        objective: input.objective,
        leadBackend: input.leadBackend || runtimeSettings.leadBackend,
        workerBackend: input.workerBackend || runtimeSettings.defaultWorkerBackend,
        status: 'queued',
        createdAt: now,
        updatedAt: now,
        startedAt: null,
        completedAt: null,
        maxParallel: input.maxParallel ?? 3,
        maxRounds: input.maxRounds ?? 2,
        maxEvalRounds: input.maxEvalRounds ?? 2,
        rulesDocPath: input.rulesDocPath || null,
        rulesDocUsed: false,
        resultSummary: null,
        error: null,
        runnerPid: null,
        paused: false,
        phase: null,
        planningTaskId: null,
        evaluationTaskId: null,
        evaluationRound: 0,
      };

      const db = openDb(stateRoot);
      try {
        upsertLeadRun(db, run);

        if (input.items && input.items.length > 0) {
          for (let i = 0; i < input.items.length; i++) {
            upsertLeadRunItem(db, {
              runId: runIdValue,
              taskIndex: i,
              label: input.items[i].label || `item-${i + 1}`,
              instruction: input.items[i].instruction,
              status: 'pending',
              round: 1,
            });
          }
        }

        insertLeadRunEvent(db, {
          runId: runIdValue,
          repoRoot,
          eventType: 'lead_run_created',
          content: `Lead run created: ${runLabel}`,
          metadata: {
            objective: shortenText(input.objective, 200),
            itemCount: input.items?.length || 0,
            leadBackend: run.leadBackend,
            workerBackend: run.workerBackend,
          },
        });
      } finally {
        db.close();
      }

      const logDir = path.join(stateRoot, 'lead-logs');
      fs.mkdirSync(logDir, { recursive: true });
      const child = spawnDetached(process.execPath, [leadRunnerPath, runIdValue], {
        cwd: repoRoot,
        env: {
          ...process.env,
          TEAMLEAD_REPO_ROOT: repoRoot,
          TEAMLEAD_STATE_ROOT: stateRoot,
        },
        stdoutPath: path.join(logDir, `${runIdValue}-stdout.log`),
        stderrPath: path.join(logDir, `${runIdValue}-stderr.log`),
      });

      const dbUpdate = openDb(stateRoot);
      try {
        const freshRun = getLeadRunById(dbUpdate, runIdValue);
        if (freshRun) {
          upsertLeadRun(dbUpdate, {
            ...freshRun,
            runnerPid: child.pid,
            updatedAt: nowIso(),
          });
        }
      } finally {
        dbUpdate.close();
      }

      return toTextResult('create_lead_run', {
        id: runIdValue,
        status: 'queued',
        runnerPid: child.pid,
        label: runLabel,
        leadBackend: run.leadBackend,
        workerBackend: run.workerBackend,
        itemCount: input.items?.length || 0,
      });
    },
  );

  server.registerTool(
    'get_lead_run',
    {
      description: 'Inspect a lead run including its items and recent events.',
      inputSchema: z.object({ runId: z.string().min(1) }).strict(),
    },
    async (input) => {
      const db = openDb(stateRoot);
      try {
        const run = getLeadRunById(db, input.runId);
        if (!run) {
          throw new Error(`Lead run not found: ${input.runId}`);
        }
        const items = listLeadRunItems(db, input.runId);
        const events = listLeadRunEvents(db, input.runId, { limit: 100 });
        return toTextResult('get_lead_run', { run, items, events });
      } finally {
        db.close();
      }
    },
  );

  server.registerTool(
    'list_lead_runs',
    {
      description: 'List recent lead runs for this repository.',
      inputSchema: z
        .object({
          status: z
            .enum(['queued', 'planning', 'running', 'evaluating', 'completed', 'failed', 'cancelled'])
            .optional(),
          limit: z.number().int().min(1).max(100).optional(),
        })
        .strict(),
    },
    async (input) => {
      const db = openDb(stateRoot);
      try {
        const runs = listLeadRunsForRepo(db, repoRoot, {
          status: input.status,
          limit: input.limit,
        });
        return toTextResult('list_lead_runs', {
          count: runs.length,
          runs: runs.map((run) => ({
            id: run.id,
            label: run.label,
            status: run.status,
            phase: run.phase,
            leadBackend: run.leadBackend,
            workerBackend: run.workerBackend,
            evaluationRound: run.evaluationRound,
            maxEvalRounds: run.maxEvalRounds,
            paused: run.paused,
            updatedAt: run.updatedAt,
            error: run.error,
          })),
        });
      } finally {
        db.close();
      }
    },
  );
}
