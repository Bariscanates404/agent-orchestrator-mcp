import { json, parseJson } from './helpers.mjs';

function normalizeTaskRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    repoRoot: row.repo_root,
    stateRoot: row.state_root,
    label: row.label,
    requestedBackend: row.requested_backend,
    backend: row.backend,
    fallbackBackend: row.fallback_backend,
    fallbackUsed: Boolean(row.fallback_used),
    prompt: row.prompt,
    promptSummary: row.prompt_summary,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    exitCode: row.exit_code,
    exitSignal: row.exit_signal,
    runnerPid: row.runner_pid,
    agentPid: row.agent_pid,
    error: row.error,
    parentTaskId: row.parent_task_id,
    escalationReason: row.escalation_reason,
    worktree: {
      mode: row.worktree_mode,
      path: row.worktree_path,
      branch: row.worktree_branch,
    },
    logs: parseJson(row.logs_json),
    execution: parseJson(row.execution_json),
  };
}

export function upsertTask(db, task) {
  db.prepare(`
    INSERT INTO tasks(
      id, repo_root, state_root, label, requested_backend, backend, fallback_backend, fallback_used,
      prompt, prompt_summary, status, created_at, updated_at, started_at, completed_at,
      exit_code, exit_signal, runner_pid, agent_pid, error, parent_task_id, escalation_reason,
      worktree_mode, worktree_path, worktree_branch, logs_json, execution_json
    ) VALUES (
      @id, @repo_root, @state_root, @label, @requested_backend, @backend, @fallback_backend, @fallback_used,
      @prompt, @prompt_summary, @status, @created_at, @updated_at, @started_at, @completed_at,
      @exit_code, @exit_signal, @runner_pid, @agent_pid, @error, @parent_task_id, @escalation_reason,
      @worktree_mode, @worktree_path, @worktree_branch, @logs_json, @execution_json
    )
    ON CONFLICT(id) DO UPDATE SET
      repo_root = excluded.repo_root,
      state_root = excluded.state_root,
      label = excluded.label,
      requested_backend = excluded.requested_backend,
      backend = excluded.backend,
      fallback_backend = excluded.fallback_backend,
      fallback_used = excluded.fallback_used,
      prompt = excluded.prompt,
      prompt_summary = excluded.prompt_summary,
      status = excluded.status,
      updated_at = excluded.updated_at,
      started_at = excluded.started_at,
      completed_at = excluded.completed_at,
      exit_code = excluded.exit_code,
      exit_signal = excluded.exit_signal,
      runner_pid = excluded.runner_pid,
      agent_pid = excluded.agent_pid,
      error = excluded.error,
      parent_task_id = excluded.parent_task_id,
      escalation_reason = excluded.escalation_reason,
      worktree_mode = excluded.worktree_mode,
      worktree_path = excluded.worktree_path,
      worktree_branch = excluded.worktree_branch,
      logs_json = excluded.logs_json,
      execution_json = excluded.execution_json
  `).run({
    id: task.id,
    repo_root: task.repoRoot,
    state_root: task.stateRoot,
    label: task.label,
    requested_backend: task.requestedBackend || task.backend,
    backend: task.backend,
    fallback_backend: task.fallbackBackend || null,
    fallback_used: task.fallbackUsed ? 1 : 0,
    prompt: task.prompt,
    prompt_summary: task.promptSummary || null,
    status: task.status,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    started_at: task.startedAt || null,
    completed_at: task.completedAt || null,
    exit_code: task.exitCode ?? null,
    exit_signal: task.exitSignal || null,
    runner_pid: task.runnerPid ?? null,
    agent_pid: task.agentPid ?? null,
    error: task.error || null,
    parent_task_id: task.parentTaskId || null,
    escalation_reason: task.escalationReason || null,
    worktree_mode: task.worktree?.mode || null,
    worktree_path: task.worktree?.path || null,
    worktree_branch: task.worktree?.branch || null,
    logs_json: json(task.logs),
    execution_json: json(task.execution),
  });
}

export function getTaskById(db, taskId) {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  return normalizeTaskRow(row);
}

export function listTasksForRepo(db, repoRoot, options = {}) {
  const clauses = ['repo_root = ?'];
  const params = [repoRoot];
  if (options.status) {
    clauses.push('status = ?');
    params.push(options.status);
  }
  params.push(options.limit || 50);
  const rows = db
    .prepare(
      `
    SELECT *
    FROM tasks
    WHERE ${clauses.join(' AND ')}
    ORDER BY updated_at DESC
    LIMIT ?
  `,
    )
    .all(...params);
  return rows.map(normalizeTaskRow);
}

export function getTaskStatusCounts(db, repoRoot) {
  const rows = db
    .prepare(
      `
    SELECT status, COUNT(*) AS count
    FROM tasks
    WHERE repo_root = ?
    GROUP BY status
  `,
    )
    .all(repoRoot);
  return rows.reduce((acc, row) => {
    acc[row.status] = row.count;
    return acc;
  }, {});
}

export function countActiveTasks(db, repoRoot) {
  const row = db
    .prepare("SELECT COUNT(*) AS cnt FROM tasks WHERE repo_root = ? AND status IN ('queued','preparing','running')")
    .get(repoRoot);
  return row?.cnt || 0;
}

export function listStaleTasks(db, repoRoot, maxIdleMs) {
  const cutoff = new Date(Date.now() - maxIdleMs).toISOString();
  return db
    .prepare(
      "SELECT * FROM tasks WHERE repo_root = ? AND status IN ('queued','preparing','running') AND updated_at < ? ORDER BY updated_at ASC",
    )
    .all(repoRoot, cutoff)
    .map(normalizeTaskRow);
}
