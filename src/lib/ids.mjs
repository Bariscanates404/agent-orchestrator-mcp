import crypto from 'node:crypto';
import path from 'node:path';
import { sanitizeName } from './text.mjs';

export function repoSlug(repoRoot) {
  const hash = crypto.createHash('sha1').update(repoRoot).digest('hex').slice(0, 10);
  return `${sanitizeName(path.basename(repoRoot))}-${hash}`;
}

export function makeTaskId(label) {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14);
  const rand = crypto.randomBytes(4).toString('hex');
  return `${stamp}-${sanitizeName(label)}-${rand}`;
}
