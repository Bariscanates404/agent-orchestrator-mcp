import { openDb } from '../db/index.mjs';

export function withDb(stateRoot, fn) {
  const db = openDb(stateRoot);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
