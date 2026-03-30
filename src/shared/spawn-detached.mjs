import { spawn } from 'node:child_process';
import fs from 'node:fs';

export function spawnDetached(command, args, { cwd, env, stdoutPath, stderrPath }) {
  const outFd = fs.openSync(stdoutPath, 'a');
  const errFd = fs.openSync(stderrPath, 'a');
  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    stdio: ['ignore', outFd, errFd],
  });
  child.unref();
  fs.closeSync(outFd);
  fs.closeSync(errFd);
  return child;
}
