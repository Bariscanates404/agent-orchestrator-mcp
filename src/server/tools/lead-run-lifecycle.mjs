import { z } from 'zod';
import {
  getLeadRunById,
  getNextItemTaskIndex,
  insertLeadRunEvent,
  openDb,
  upsertLeadRun,
  upsertLeadRunItem,
} from '../../db/index.mjs';
import { shortenText } from '../../lib/index.mjs';
import { LEAD_TERMINAL_STATES } from '../../shared/constants.mjs';
import { toTextResult } from '../../shared/mcp-result.mjs';
import { nowIso } from '../../shared/time.mjs';

export function registerLeadRunLifecycleTools(server, { repoRoot, stateRoot }) {
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
}
