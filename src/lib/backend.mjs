import { runCommand } from './process.mjs';

export async function detectBackend(command, versionArgs = ['--version']) {
  const version = await runCommand(command, versionArgs);
  if (!version.ok) {
    return {
      command,
      available: false,
      version: null,
      details: (version.stderr || version.stdout || '').trim(),
    };
  }
  return {
    command,
    available: true,
    version: (version.stdout || version.stderr || '').trim().split('\n')[0],
    details: null,
  };
}

export async function discoverBackends() {
  const [claude, codex] = await Promise.all([detectBackend('claude', ['--version']), detectBackend('codex', ['-V'])]);
  return { claude, codex };
}
