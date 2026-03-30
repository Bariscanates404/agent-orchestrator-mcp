import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function getDbPath(stateRoot) {
  return path.join(stateRoot, 'orchestrator.db');
}

const VALID_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function ensureColumn(db, tableName, columnName, definition) {
  if (!VALID_IDENTIFIER.test(tableName) || !VALID_IDENTIFIER.test(columnName)) {
    throw new Error(`Invalid identifier: table=${tableName}, column=${columnName}`);
  }
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

export function openDb(stateRoot) {
  fs.mkdirSync(stateRoot, { recursive: true });
  const db = new DatabaseSync(getDbPath(stateRoot));
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA temp_store = MEMORY;');
  db.exec('PRAGMA cache_size = -8000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      repo_root TEXT NOT NULL,
      state_root TEXT NOT NULL,
      label TEXT NOT NULL,
      requested_backend TEXT NOT NULL,
      backend TEXT NOT NULL,
      fallback_backend TEXT,
      fallback_used INTEGER NOT NULL DEFAULT 0,
      prompt TEXT NOT NULL,
      prompt_summary TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      exit_code INTEGER,
      exit_signal TEXT,
      runner_pid INTEGER,
      agent_pid INTEGER,
      error TEXT,
      parent_task_id TEXT,
      escalation_reason TEXT,
      worktree_mode TEXT,
      worktree_path TEXT,
      worktree_branch TEXT,
      logs_json TEXT,
      execution_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_repo_updated ON tasks(repo_root, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      repo_root TEXT NOT NULL,
      stream TEXT NOT NULL,
      event_type TEXT NOT NULL,
      content TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_task_events_task_id ON task_events(task_id, id);
    CREATE INDEX IF NOT EXISTS idx_task_events_repo_root ON task_events(repo_root, id DESC);

    CREATE TABLE IF NOT EXISTS lead_runs (
      id TEXT PRIMARY KEY,
      repo_root TEXT NOT NULL,
      state_root TEXT NOT NULL,
      label TEXT NOT NULL,
      objective TEXT NOT NULL,
      lead_backend TEXT NOT NULL,
      worker_backend TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      max_parallel INTEGER NOT NULL DEFAULT 3,
      max_rounds INTEGER NOT NULL DEFAULT 2,
      rules_doc_path TEXT,
      rules_doc_used INTEGER NOT NULL DEFAULT 0,
      result_summary TEXT,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_lead_runs_repo_updated ON lead_runs(repo_root, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_lead_runs_status ON lead_runs(status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS lead_run_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      task_index INTEGER NOT NULL,
      label TEXT,
      instruction TEXT NOT NULL,
      status TEXT NOT NULL,
      worker_task_id TEXT,
      round INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      result_text TEXT,
      error TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_run_items_unique ON lead_run_items(run_id, task_index);
    CREATE INDEX IF NOT EXISTS idx_lead_run_items_status ON lead_run_items(run_id, status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS lead_run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      repo_root TEXT NOT NULL,
      event_type TEXT NOT NULL,
      content TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_lead_run_events_run ON lead_run_events(run_id, id);
    CREATE INDEX IF NOT EXISTS idx_lead_run_events_repo ON lead_run_events(repo_root, id DESC);
  `);
  ensureColumn(db, 'tasks', 'parent_task_id', 'TEXT');
  ensureColumn(db, 'tasks', 'escalation_reason', 'TEXT');
  ensureColumn(db, 'lead_runs', 'max_rounds', 'INTEGER NOT NULL DEFAULT 2');
  ensureColumn(db, 'lead_runs', 'rules_doc_path', 'TEXT');
  ensureColumn(db, 'lead_runs', 'rules_doc_used', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'lead_runs', 'result_summary', 'TEXT');
  ensureColumn(db, 'lead_runs', 'error', 'TEXT');
  ensureColumn(db, 'lead_run_items', 'round', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'lead_run_items', 'result_text', 'TEXT');
  ensureColumn(db, 'lead_run_items', 'error', 'TEXT');
  ensureColumn(db, 'lead_runs', 'runner_pid', 'INTEGER');
  ensureColumn(db, 'lead_runs', 'paused', 'INTEGER DEFAULT 0');
  ensureColumn(db, 'lead_runs', 'phase', 'TEXT');
  ensureColumn(db, 'lead_runs', 'planning_task_id', 'TEXT');
  ensureColumn(db, 'lead_runs', 'evaluation_task_id', 'TEXT');
  ensureColumn(db, 'lead_runs', 'evaluation_round', 'INTEGER DEFAULT 0');
  ensureColumn(db, 'lead_runs', 'max_eval_rounds', 'INTEGER DEFAULT 2');
  ensureColumn(db, 'tasks', 'workspace_path', 'TEXT');
  return db;
}
