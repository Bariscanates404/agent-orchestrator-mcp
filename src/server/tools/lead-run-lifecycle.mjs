import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  getLeadRunById,
  getNextItemTaskIndex,
  insertLeadRunEvent,
  openDb,
  reopenLeadRun,
  upsertLeadRun,
  upsertLeadRunItem,
} from '../../db/index.mjs';
import { shortenText } from '../../lib/index.mjs';
import { LEAD_EVENT, LEAD_TERMINAL_STATES } from '../../shared/constants.mjs';
import { toTextResult } from '../../shared/mcp-result.mjs';
import { spawnDetached } from '../../shared/spawn-detached.mjs';
import { nowIso } from '../../shared/time.mjs';

export function registerLeadRunLifecycleTools(server, { repoRoot, stateRoot, leadRunnerPath }) {
  server.registerTool(
    'pause_lead_run',
    {
      description: 'Pause a running lead run. Already-launched workers continue, but no new items are launched.',
      inputSchema: z.object({ runId: z.string().min(1) }).strict(),
    },
    async (input) => {
      const db = openDb(stateRoot);
      try {
        const run = getLeadRunById(db, input.runId);
        if (!run) {
          throw new Error(`Lead run not found: ${input.runId}`);
        }
        if (LEAD_TERMINAL_STATES.has(run.status)) {
          return toTextResult('pause_lead_run', {
            runId: run.id,
            paused: false,
            reason: 'Lead run already finished.',
          });
        }
        upsertLeadRun(db, {
          ...run,
          paused: true,
          updatedAt: nowIso(),
        });
        insertLeadRunEvent(db, {
          runId: run.id,
          repoRoot,
          eventType: 'paused',
          content: 'Lead run paused by operator.',
        });
        return toTextResult('pause_lead_run', { runId: run.id, paused: true });
      } finally {
        db.close();
      }
    },
  );

  server.registerTool(
    'resume_lead_run',
    {
      description: 'Resume a paused lead run.',
      inputSchema: z.object({ runId: z.string().min(1) }).strict(),
    },
    async (input) => {
      const db = openDb(stateRoot);
      try {
        const run = getLeadRunById(db, input.runId);
        if (!run) {
          throw new Error(`Lead run not found: ${input.runId}`);
        }
        if (!run.paused) {
          return toTextResult('resume_lead_run', {
            runId: run.id,
            resumed: false,
            reason: 'Lead run is not paused.',
          });
        }
        upsertLeadRun(db, {
          ...run,
          paused: false,
          updatedAt: nowIso(),
        });
        insertLeadRunEvent(db, {
          runId: run.id,
          repoRoot,
          eventType: 'resumed',
          content: 'Lead run resumed by operator.',
        });
        return toTextResult('resume_lead_run', { runId: run.id, resumed: true });
      } finally {
        db.close();
      }
    },
  );

  server.registerTool(
    'cancel_lead_run',
    {
      description: 'Cancel a lead run by signalling its runner process.',
      inputSchema: z.object({ runId: z.string().min(1) }).strict(),
    },
    async (input) => {
      const db = openDb(stateRoot);
      try {
        const run = getLeadRunById(db, input.runId);
        if (!run) {
          throw new Error(`Lead run not found: ${input.runId}`);
        }
        if (LEAD_TERMINAL_STATES.has(run.status)) {
          return toTextResult('cancel_lead_run', {
            runId: run.id,
            cancelled: false,
            reason: 'Lead run already finished.',
          });
        }

        if (run.runnerPid) {
          try {
            process.kill(-run.runnerPid, 'SIGTERM');
          } catch {
            try {
              process.kill(run.runnerPid, 'SIGTERM');
            } catch {
              // Process may have already exited
            }
          }
        }

        upsertLeadRun(db, {
          ...run,
          status: 'cancelled',
          updatedAt: nowIso(),
          completedAt: nowIso(),
          error: 'Cancelled by operator.',
        });
        insertLeadRunEvent(db, {
          runId: run.id,
          repoRoot,
          eventType: 'cancelled',
          content: 'Lead run cancelled by operator.',
          metadata: { runnerPid: run.runnerPid },
        });
        return toTextResult('cancel_lead_run', { runId: run.id, cancelled: true });
      } finally {
        db.close();
      }
    },
  );

  server.registerTool(
    'add_lead_run_item',
    {
      description: 'Add a new subtask item to a running lead run.',
      inputSchema: z
        .object({
          runId: z.string().min(1),
          instruction: z.string().min(1),
          label: z.string().optional(),
        })
        .strict(),
    },
    async (input) => {
      const db = openDb(stateRoot);
      try {
        const run = getLeadRunById(db, input.runId);
        if (!run) {
          throw new Error(`Lead run not found: ${input.runId}`);
        }
        if (LEAD_TERMINAL_STATES.has(run.status)) {
          throw new Error(`Cannot add items to a ${run.status} lead run.`);
        }

        const nextIndex = getNextItemTaskIndex(db, input.runId);
        upsertLeadRunItem(db, {
          runId: input.runId,
          taskIndex: nextIndex,
          label: input.label || `manual-item-${nextIndex + 1}`,
          instruction: input.instruction,
          status: 'pending',
          round: 1,
        });

        insertLeadRunEvent(db, {
          runId: input.runId,
          repoRoot,
          eventType: 'item_added',
          content: `Manual item ${nextIndex + 1} added by operator.`,
          metadata: {
            taskIndex: nextIndex,
            label: input.label,
            instructionSnippet: shortenText(input.instruction, 200),
          },
        });

        return toTextResult('add_lead_run_item', {
          runId: input.runId,
          taskIndex: nextIndex,
          label: input.label || `manual-item-${nextIndex + 1}`,
          status: 'pending',
        });
      } finally {
        db.close();
      }
    },
  );

  server.registerTool(
    'continue_lead_run',
    {
      description:
        'Reopen a completed, failed, or cancelled lead run. Optionally provide a new objective (triggers re-planning) or manual items (added as pending subtasks).',
      inputSchema: z
        .object({
          runId: z.string().min(1),
          objective: z
            .string()
            .optional()
            .describe('New objective. If provided, the lead re-plans from scratch with this goal.'),
          items: z
            .array(z.object({ label: z.string().optional(), instruction: z.string().min(1) }))
            .optional()
            .describe('Manual subtasks to add. Skips re-planning if provided.'),
        })
        .strict(),
    },
    async (input) => {
      const db = openDb(stateRoot);
      try {
        const run = getLeadRunById(db, input.runId);
        if (!run) {
          throw new Error(`Lead run not found: ${input.runId}`);
        }
        if (!LEAD_TERMINAL_STATES.has(run.status)) {
          return toTextResult('continue_lead_run', {
            runId: run.id,
            continued: false,
            reason: `Lead run is still ${run.status}, not in a terminal state.`,
          });
        }

        // Determine phase: if new objective (no manual items) → re-plan; otherwise → execute
        const hasManualItems = Array.isArray(input.items) && input.items.length > 0;
        const phase = input.objective && !hasManualItems ? 'planning' : 'executing';

        reopenLeadRun(db, input.runId, {
          phase,
          objective: input.objective || null,
        });

        // Add manual items as pending
        if (hasManualItems) {
          const baseIndex = getNextItemTaskIndex(db, input.runId);
          for (let i = 0; i < input.items.length; i++) {
            upsertLeadRunItem(db, {
              runId: input.runId,
              taskIndex: baseIndex + i,
              label: input.items[i].label || `continue-item-${baseIndex + i + 1}`,
              instruction: input.items[i].instruction,
              status: 'pending',
              round: 1,
            });
          }
        }

        insertLeadRunEvent(db, {
          runId: input.runId,
          repoRoot,
          eventType: LEAD_EVENT.RUN_CONTINUED,
          content: `Lead run reopened from ${run.status} by operator.${input.objective ? ' New objective set.' : ''}${hasManualItems ? ` ${input.items.length} manual items added.` : ''}`,
          metadata: {
            previousStatus: run.status,
            newObjective: input.objective || null,
            manualItemCount: hasManualItems ? input.items.length : 0,
            phase,
          },
        });
      } finally {
        db.close();
      }

      // Spawn a new lead runner subprocess
      const logDir = path.join(stateRoot, 'lead-logs');
      fs.mkdirSync(logDir, { recursive: true });
      const child = spawnDetached(process.execPath, [leadRunnerPath, input.runId], {
        cwd: repoRoot,
        env: {
          ...process.env,
          TEAMLEAD_REPO_ROOT: repoRoot,
          TEAMLEAD_STATE_ROOT: stateRoot,
        },
        stdoutPath: path.join(logDir, `${input.runId}-stdout.log`),
        stderrPath: path.join(logDir, `${input.runId}-stderr.log`),
      });

      const dbUpdate = openDb(stateRoot);
      try {
        const freshRun = getLeadRunById(dbUpdate, input.runId);
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

      return toTextResult('continue_lead_run', {
        runId: input.runId,
        continued: true,
        phase,
        runnerPid: child.pid,
      });
    },
  );
}
