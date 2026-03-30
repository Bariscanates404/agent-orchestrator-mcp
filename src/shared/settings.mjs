import { getSettings, openDb } from '../db/index.mjs';

const envDefaultWorkerBackend = process.env.ORCHESTRATOR_DEFAULT_BACKEND || 'claude';
const envCodexFallbackBackend = process.env.ORCHESTRATOR_CODEX_FALLBACK || 'claude';
const envDefaultLeadBackend = process.env.ORCHESTRATOR_DEFAULT_LEAD || 'codex';

export function getRuntimeSettings(stateRoot) {
  const db = openDb(stateRoot);
  try {
    const settings = getSettings(db);
    return {
      leadBackend: settings.leadBackend || envDefaultLeadBackend,
      defaultWorkerBackend: settings.defaultWorkerBackend || envDefaultWorkerBackend,
      codexFallbackBackend: settings.codexFallbackBackend || envCodexFallbackBackend,
    };
  } finally {
    db.close();
  }
}
