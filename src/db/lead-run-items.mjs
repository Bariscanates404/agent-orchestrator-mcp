import { nowIso } from '../shared/time.mjs';

function normalizeLeadRunItemRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    runId: row.run_id,
    taskIndex: row.task_index,
    label: row.label,
    instruction: row.instruction,
    status: row.status,
    workerTaskId: row.worker_task_id,
    round: row.round,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    resultText: row.result_text,
    error: row.error,
  };
}

export function upsertLeadRunItem(db, item) {
  const now = nowIso();
  const createdAt = item.createdAt || now;
  const updatedAt = item.updatedAt || now;
  db.prepare(`
    INSERT INTO lead_run_items(
      run_id, task_index, label, instruction, status, worker_task_id, round,
      created_at, updated_at, completed_at, result_text, error
    ) VALUES (
      @run_id, @task_index, @label, @instruction, @status, @worker_task_id, @round,
      @created_at, @updated_at, @completed_at, @result_text, @error
    )
    ON CONFLICT(run_id, task_index) DO UPDATE SET
      label = excluded.label,
      instruction = excluded.instruction,
      status = excluded.status,
      worker_task_id = excluded.worker_task_id,
      round = excluded.round,
      updated_at = excluded.updated_at,
      completed_at = excluded.completed_at,
      result_text = excluded.result_text,
      error = excluded.error
  `).run({
    run_id: item.runId,
    task_index: item.taskIndex,
    label: item.label || null,
    instruction: item.instruction,
    status: item.status,
    worker_task_id: item.workerTaskId || null,
    round: item.round ?? 1,
    created_at: createdAt,
    updated_at: updatedAt,
    completed_at: item.completedAt || null,
    result_text: item.resultText || null,
    error: item.error || null,
  });
}

export function listLeadRunItems(db, runId) {
  const rows = db
    .prepare(
      `
    SELECT *
    FROM lead_run_items
    WHERE run_id = ?
    ORDER BY task_index ASC
  `,
    )
    .all(runId);
  return rows.map(normalizeLeadRunItemRow);
}

export function getLeadRunItemsByStatus(db, runId, status) {
  const rows = db
    .prepare(
      `
    SELECT *
    FROM lead_run_items
    WHERE run_id = ? AND status = ?
    ORDER BY task_index ASC
  `,
    )
    .all(runId, status);
  return rows.map(normalizeLeadRunItemRow);
}

export function getNextItemTaskIndex(db, runId) {
  const row = db
    .prepare(
      `
    SELECT COALESCE(MAX(task_index), -1) + 1 AS next_index
    FROM lead_run_items
    WHERE run_id = ?
  `,
    )
    .get(runId);
  return row.next_index;
}

export function insertItemAtomic(db, item) {
  const fn = db.transaction(() => {
    const nextIndex = getNextItemTaskIndex(db, item.runId);
    upsertLeadRunItem(db, { ...item, taskIndex: nextIndex });
    return nextIndex;
  });
  return fn();
}
