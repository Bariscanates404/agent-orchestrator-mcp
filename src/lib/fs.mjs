import fs from 'node:fs/promises';
import path from 'node:path';

export async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

export async function writeJsonAtomic(filePath, data) {
  const tempFile = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tempFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(tempFile, filePath);
}

export async function updateJsonFile(filePath, updater) {
  const current = await readJson(filePath);
  const next = await updater(structuredClone(current));
  await writeJsonAtomic(filePath, next);
  return next;
}

export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readTail(filePath, maxLines = 120) {
  if (!(await pathExists(filePath))) {
    return [];
  }
  const raw = await fs.readFile(filePath, 'utf8');
  return raw.split('\n').slice(-maxLines).filter(Boolean);
}

export async function ensureRepoStatePaths(repoRoot, stateRoot) {
  const { getRepoStatePaths } = await import('./paths.mjs');
  const dirs = getRepoStatePaths(repoRoot, stateRoot);
  await fs.mkdir(dirs.tasksDir, { recursive: true });
  await fs.mkdir(dirs.worktreesDir, { recursive: true });
  await fs.mkdir(dirs.reportsDir, { recursive: true });
  return dirs;
}
