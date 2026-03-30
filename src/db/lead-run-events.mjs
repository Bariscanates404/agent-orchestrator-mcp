import { nowIso } from '../shared/time.mjs';
import { json, parseJson } from './helpers.mjs';

export function insertLeadRunEvent(db, event) {
  const result = db
    .prepare(
      `
    INSERT INTO lead_run_events(run_id, repo_root, event_type, content, metadata_json, created_at)
    VALUES(?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      event.runId,
      event.repoRoot,
      event.eventType,
      event.content || null,
      json(event.metadata || null),
      event.createdAt || nowIso(),
    );
  return Number(result.lastInsertRowid);
}

export function listLeadRunEvents(db, runId, options = {}) {
  const rows = db
    .prepare(
      `
    SELECT *
    FROM lead_run_events
    WHERE run_id = ? AND id > ?
    ORDER BY id ASC
    LIMIT ?
  `,
    )
    .all(runId, options.afterId || 0, options.limit || 500);
  return rows.map((row) => ({
    id: row.id,
    runId: row.run_id,
    repoRoot: row.repo_root,
    eventType: row.event_type,
    content: row.content,
    metadata: parseJson(row.metadata_json),
    createdAt: row.created_at,
  }));
}
