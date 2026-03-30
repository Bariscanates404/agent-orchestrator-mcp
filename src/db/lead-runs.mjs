import { nowIso } from '../shared/time.mjs';

function normalizeLeadRunRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    repoRoot: row.repo_root,
    stateRoot: row.state_root,
    label: row.label,
    objective: row.objective,
    leadBackend: row.lead_backend,
    workerBackend: row.worker_backend,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    maxParallel: row.max_parallel,
    maxRounds: row.max_rounds,
    rulesDocPath: row.rules_doc_path,
    rulesDocUsed: Boolean(row.rules_doc_used),
    runnerPid: row.runner_pid,
    paused: Boolean(row.paused),
    phase: row.phase,
    planningTaskId: row.planning_task_id,
    evaluationTaskId: row.evaluation_task_id,
    evaluationRound: row.evaluation_round ?? 0,
    maxEvalRounds: row.max_eval_rounds ?? 2,
    resultSummary: row.result_summary,
    error: row.error,
  };
}

export function upsertLeadRun(db, run) {
  db.prepare(`
    INSERT INTO lead_runs(
      id, repo_root, state_root, label, objective, lead_backend, worker_backend, status,
      created_at, updated_at, started_at, completed_at,
      max_parallel, max_rounds, rules_doc_path, rules_doc_used, result_summary, error,
      runner_pid, paused, phase, planning_task_id, evaluation_task_id, evaluation_round, max_eval_rounds
    ) VALUES (
      @id, @repo_root, @state_root, @label, @objective, @lead_backend, @worker_backend, @status,
      @created_at, @updated_at, @started_at, @completed_at,
      @max_parallel, @max_rounds, @rules_doc_path, @rules_doc_used, @result_summary, @error,
      @runner_pid, @paused, @phase, @planning_task_id, @evaluation_task_id, @evaluation_round, @max_eval_rounds
    )
    ON CONFLICT(id) DO UPDATE SET
      repo_root = excluded.repo_root,
      state_root = excluded.state_root,
      label = excluded.label,
      objective = excluded.objective,
      lead_backend = excluded.lead_backend,
      worker_backend = excluded.worker_backend,
      status = excluded.status,
      updated_at = excluded.updated_at,
      started_at = excluded.started_at,
      completed_at = excluded.completed_at,
      max_parallel = excluded.max_parallel,
      max_rounds = excluded.max_rounds,
      rules_doc_path = excluded.rules_doc_path,
      rules_doc_used = excluded.rules_doc_used,
      result_summary = excluded.result_summary,
      error = excluded.error,
      runner_pid = excluded.runner_pid,
      paused = excluded.paused,
      phase = excluded.phase,
      planning_task_id = excluded.planning_task_id,
      evaluation_task_id = excluded.evaluation_task_id,
      evaluation_round = excluded.evaluation_round,
      max_eval_rounds = excluded.max_eval_rounds
  `).run({
    id: run.id,
    repo_root: run.repoRoot,
    state_root: run.stateRoot,
    label: run.label,
    objective: run.objective,
    lead_backend: run.leadBackend,
    worker_backend: run.workerBackend,
    status: run.status,
    created_at: run.createdAt,
    updated_at: run.updatedAt,
    started_at: run.startedAt || null,
    completed_at: run.completedAt || null,
    max_parallel: run.maxParallel ?? 3,
    max_rounds: run.maxRounds ?? 2,
    rules_doc_path: run.rulesDocPath || null,
    rules_doc_used: run.rulesDocUsed ? 1 : 0,
    result_summary: run.resultSummary || null,
    error: run.error || null,
    runner_pid: run.runnerPid ?? null,
    paused: run.paused ? 1 : 0,
    phase: run.phase || null,
    planning_task_id: run.planningTaskId || null,
    evaluation_task_id: run.evaluationTaskId || null,
    evaluation_round: run.evaluationRound ?? 0,
    max_eval_rounds: run.maxEvalRounds ?? 2,
  });
}

export function reopenLeadRun(db, runId, { phase = 'executing', objective = null } = {}) {
  db.prepare(`
    UPDATE lead_runs
    SET status = 'running',
        phase = ?,
        paused = 0,
        completed_at = NULL,
        error = NULL,
        evaluation_round = 0,
        updated_at = ?
    WHERE id = ?
  `).run(phase, nowIso(), runId);

  if (objective) {
    db.prepare('UPDATE lead_runs SET objective = ? WHERE id = ?').run(objective, runId);
  }
}

export function getLeadRunById(db, runId) {
  const row = db.prepare('SELECT * FROM lead_runs WHERE id = ?').get(runId);
  return normalizeLeadRunRow(row);
}

export function listLeadRunsForRepo(db, repoRoot, options = {}) {
  const clauses = ['repo_root = ?'];
  const params = [repoRoot];
  if (options.status) {
    clauses.push('status = ?');
    params.push(options.status);
  }
  params.push(options.limit || 40);
  const rows = db
    .prepare(
      `
    SELECT *
    FROM lead_runs
    WHERE ${clauses.join(' AND ')}
    ORDER BY updated_at DESC
    LIMIT ?
  `,
    )
    .all(...params);
  return rows.map(normalizeLeadRunRow);
}
