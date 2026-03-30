import { nowIso } from '../shared/time.mjs';
import { json, parseJson } from './helpers.mjs';

export function insertTaskEvent(db, event) {
  const result = db
    .prepare(
      `
    INSERT INTO task_events(task_id, repo_root, stream, event_type, content, metadata_json, created_at)
    VALUES(?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      event.taskId,
      event.repoRoot,
      event.stream,
      event.eventType,
      event.content || null,
      json(event.metadata || null),
      event.createdAt || nowIso(),
    );
  return Number(result.lastInsertRowid);
}

export function listTaskEvents(db, taskId, options = {}) {
  const rows = db
    .prepare(
      `
    SELECT *
    FROM task_events
    WHERE task_id = ? AND id > ?
    ORDER BY id ASC
    LIMIT ?
  `,
    )
    .all(taskId, options.afterId || 0, options.limit || 500);
  return rows.map((row) => ({
    id: row.id,
    taskId: row.task_id,
    repoRoot: row.repo_root,
    stream: row.stream,
    eventType: row.event_type,
    content: row.content,
    metadata: parseJson(row.metadata_json),
    createdAt: row.created_at,
  }));
}

export function listRepoEvents(db, repoRoot, options = {}) {
  const rows = db
    .prepare(
      `
    SELECT *
    FROM task_events
    WHERE repo_root = ? AND id > ?
    ORDER BY id DESC
    LIMIT ?
  `,
    )
    .all(repoRoot, options.afterId || 0, options.limit || 200);

  return rows.reverse().map((row) => ({
    id: row.id,
    taskId: row.task_id,
    repoRoot: row.repo_root,
    stream: row.stream,
    eventType: row.event_type,
    content: row.content,
    metadata: parseJson(row.metadata_json),
    createdAt: row.created_at,
  }));
}
