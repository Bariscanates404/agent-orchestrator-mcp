import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolveRepoRoot, resolveStateRoot } from '../lib/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'server', 'index.mjs');
const repoRoot = resolveRepoRoot();
const stateRoot = resolveStateRoot();

const transport = new StdioClientTransport({
  command: 'node',
  args: [serverPath],
  cwd: repoRoot,
  env: {
    ...process.env,
    TEAMLEAD_REPO_ROOT: repoRoot,
    TEAMLEAD_STATE_ROOT: stateRoot,
  },
  stderr: 'pipe',
});

transport.stderr?.on('data', (chunk) => {
  process.stderr.write(chunk);
});

const client = new Client({ name: 'okx-agent-orchestrator-smoke', version: '0.1.0' });
await client.connect(transport);

const tools = await client.listTools();
const doctor = await client.callTool({ name: 'orchestrator_doctor', arguments: {} });
const launch = await client.callTool({
  name: 'launch_agent_batch',
  arguments: {
    tasks: [
      {
        label: 'smoke-claude-a',
        worktreeMode: 'reuse_repo',
        task: 'Reply with exactly OK.',
      },
      {
        label: 'smoke-claude-b',
        worktreeMode: 'reuse_repo',
        task: 'Reply with exactly OK.',
      },
    ],
  },
});

const launched = launch.structuredContent.tasks;
const deadline = Date.now() + 120000;
const finalTasks = [];
for (const entry of launched) {
  let current = null;
  while (Date.now() < deadline) {
    const response = await client.callTool({
      name: 'get_agent_task',
      arguments: { taskId: entry.id },
    });
    current = response.structuredContent;
    if (['completed', 'failed', 'cancelled'].includes(current.task.status)) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  finalTasks.push({
    id: current?.task?.id || entry.id,
    backend: current?.task?.backend || entry.backend,
    status: current?.task?.status || 'unknown',
    result: current?.summary?.agentResult || null,
  });
}

await transport.close();

console.log(
  JSON.stringify(
    {
      toolCount: tools.tools.length,
      toolNames: tools.tools.map((tool) => tool.name),
      doctor: doctor.structuredContent,
      finalTasks,
    },
    null,
    2,
  ),
);
