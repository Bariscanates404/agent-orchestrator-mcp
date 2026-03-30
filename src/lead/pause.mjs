import { getLeadRunById } from '../db/index.mjs';

export function checkPaused(db, runId) {
  const run = getLeadRunById(db, runId);
  if (!run) {
    throw new Error(`Lead run ${runId} not found during pause check`);
  }
  if (run.status === 'cancelled') {
    throw new Error('Lead run was cancelled');
  }
  return run.paused;
}

export async function waitWhilePaused(db, runId, pollMs) {
  while (checkPaused(db, runId)) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
