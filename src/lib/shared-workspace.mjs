import path from 'node:path';
import { nowIso } from '../shared/time.mjs';
import { pathExists, readJson, writeJsonAtomic } from './fs.mjs';
import { shortenText } from './text.mjs';

const SESSIONS_DIR = '.orchestrator-sessions';

// Limits — prevents workspace from eating agent context
const MAX_RECENT_ENTRIES = 15; // Keep last 15 entries in full detail
const MAX_ENTRY_CONTENT = 600; // Each entry's content max chars
const MAX_COMPACTED_SUMMARY = 2000; // Compacted history summary max chars
const MAX_WORKSPACE_JSON_BYTES = 32_000; // Hard cap ~32KB on disk

export function workspacePath(repoRoot, runId) {
  return path.join(repoRoot, SESSIONS_DIR, runId, 'workspace.json');
}

export async function initWorkspace(runId, repoRoot) {
  const filePath = workspacePath(repoRoot, runId);
  const data = {
    version: 2,
    createdAt: nowIso(),
    compactedHistory: '',
    compactedCount: 0,
    entries: [],
  };
  await writeJsonAtomic(filePath, data);
  return filePath;
}

function compactOldEntries(data) {
  if (data.entries.length <= MAX_RECENT_ENTRIES) {
    return data;
  }

  // Split: old entries get compacted, recent stay
  const cutoff = data.entries.length - MAX_RECENT_ENTRIES;
  const oldEntries = data.entries.slice(0, cutoff);
  const recentEntries = data.entries.slice(cutoff);

  // Build summary from old entries
  const oldLines = oldEntries.map((e) => `[${e.agentLabel}] ${e.type}: ${shortenText(e.content || '', 120)}`);
  const newCompacted = oldLines.join('\n');

  // Merge with existing compacted history
  let fullHistory = data.compactedHistory ? data.compactedHistory + '\n' + newCompacted : newCompacted;

  // Trim compacted history if too long (keep most recent portion)
  if (fullHistory.length > MAX_COMPACTED_SUMMARY) {
    const lines = fullHistory.split('\n');
    while (lines.join('\n').length > MAX_COMPACTED_SUMMARY && lines.length > 1) {
      lines.shift();
    }
    fullHistory = '...(eski kayitlar kisaltildi)\n' + lines.join('\n');
  }

  return {
    ...data,
    compactedHistory: fullHistory,
    compactedCount: (data.compactedCount || 0) + oldEntries.length,
    entries: recentEntries,
  };
}

export async function appendToWorkspace(filePath, { agentLabel, type, content }) {
  let data;
  if (await pathExists(filePath)) {
    data = await readJson(filePath);
  } else {
    data = { version: 2, createdAt: nowIso(), compactedHistory: '', compactedCount: 0, entries: [] };
  }

  // Truncate content before storing
  const truncatedContent = shortenText(content || '', MAX_ENTRY_CONTENT);

  data.entries.push({
    agentLabel,
    type,
    content: truncatedContent,
    timestamp: nowIso(),
  });

  // Auto-compact if over limit
  data = compactOldEntries(data);

  // Hard size check — if still too big, aggressively trim
  const jsonStr = JSON.stringify(data, null, 2);
  if (jsonStr.length > MAX_WORKSPACE_JSON_BYTES) {
    // Remove oldest recent entries until under limit
    while (data.entries.length > 3 && JSON.stringify(data).length > MAX_WORKSPACE_JSON_BYTES) {
      const removed = data.entries.shift();
      const line = `[${removed.agentLabel}] ${removed.type}: ${shortenText(removed.content || '', 80)}`;
      data.compactedHistory = (data.compactedHistory ? data.compactedHistory + '\n' : '') + line;
      data.compactedCount = (data.compactedCount || 0) + 1;
    }
    // Trim compacted history too if needed
    if (data.compactedHistory.length > MAX_COMPACTED_SUMMARY) {
      data.compactedHistory = '...(kisaltildi)\n' + data.compactedHistory.slice(-MAX_COMPACTED_SUMMARY);
    }
  }

  await writeJsonAtomic(filePath, data);
  return data;
}

export async function readWorkspace(filePath) {
  if (!(await pathExists(filePath))) {
    return { version: 2, compactedHistory: '', compactedCount: 0, entries: [] };
  }
  const data = await readJson(filePath);
  // Handle v1 format (no compactedHistory)
  if (!data.version || data.version < 2) {
    return { version: 2, compactedHistory: '', compactedCount: 0, entries: data.entries || [] };
  }
  return data;
}

export async function getWorkspaceSummary(filePath, maxLength = 3000) {
  const data = await readWorkspace(filePath);
  const parts = [];

  // Compacted history (brief overview of old work)
  if (data.compactedHistory) {
    parts.push(`=== Onceki calisma ozeti (${data.compactedCount} kayit) ===`);
    parts.push(data.compactedHistory);
    parts.push('=== Ozet sonu ===');
    parts.push('');
  }

  // Recent entries (full detail)
  if (data.entries.length > 0) {
    parts.push(`=== Son ${data.entries.length} kayit ===`);
    for (const e of data.entries) {
      parts.push(`[${e.agentLabel}] (${e.type}) ${e.timestamp || ''}:`);
      parts.push(e.content || '(icerik yok)');
      parts.push('');
    }
  }

  if (parts.length === 0) {
    return '';
  }

  return shortenText(parts.join('\n'), maxLength);
}
