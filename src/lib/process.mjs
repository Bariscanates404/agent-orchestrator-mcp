import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 16 * 1024 * 1024;

export async function runCommand(command, args = [], options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: options.env,
      maxBuffer: options.maxBuffer || MAX_BUFFER,
    });
    return {
      ok: true,
      code: 0,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
    };
  } catch (error) {
    return {
      ok: false,
      code: typeof error.code === 'number' ? error.code : 1,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message || String(error),
      error,
    };
  }
}

export async function requireCommand(command, args = ['--version']) {
  const result = await runCommand(command, args);
  if (!result.ok) {
    throw new Error(`Command not available: ${command}: ${result.stderr || result.stdout}`);
  }
  return (result.stdout || result.stderr || '').trim();
}

export async function spawnAndWait(command, args, cwd) {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('exit', (code) => {
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}
