import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolveRepoRoot, resolveStateRoot } from '../lib/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'server', 'index.mjs');

export async function connectOrchestratorClient(overrides = {}) {
  const repoRoot = overrides.repoRoot || resolveRepoRoot();
  const stateRoot = overrides.stateRoot || resolveStateRoot();
  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
    cwd: repoRoot,
    env: {
      ...process.env,
      TEAMLEAD_REPO_ROOT: repoRoot,
      TEAMLEAD_STATE_ROOT: stateRoot,
      ...overrides.env,
    },
    stderr: overrides.pipeStderr ? 'pipe' : 'inherit',
  });

  if (overrides.pipeStderr) {
    transport.stderr?.on('data', (chunk) => {
      process.stderr.write(chunk);
    });
  }

  const client = new Client({ name: overrides.clientName || 'agent-orchestrator-client', version: '0.1.0' });
  await client.connect(transport);
  return { client, transport, repoRoot, stateRoot };
}

export async function closeOrchestratorClient(context) {
  await context.transport.close();
}
