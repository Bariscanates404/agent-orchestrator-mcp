import { nowIso } from '../shared/time.mjs';

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return rows.reduce((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
}

export function updateSettings(db, settings) {
  const stmt = db.prepare(`
    INSERT INTO settings(key, value, updated_at)
    VALUES(?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `);
  const now = nowIso();
  for (const [key, value] of Object.entries(settings)) {
    if (value == null) {
      continue;
    }
    stmt.run(key, String(value), now);
  }
}
