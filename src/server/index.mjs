import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolveRepoRoot, resolveStateRoot } from '../lib/index.mjs';
import { registerDoctorTool } from './tools/doctor.mjs';
import { registerLeadRunTools } from './tools/lead-run.mjs';
import { registerLeadRunLifecycleTools } from './tools/lead-run-lifecycle.mjs';
import { registerTaskInspectTools } from './tools/task-inspect.mjs';
import { registerTaskLaunchTools } from './tools/task-launch.mjs';
import { registerTaskLifecycleTools } from './tools/task-lifecycle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = resolveRepoRoot();
const stateRoot = resolveStateRoot();
const runnerPath = path.join(__dirname, '..', 'runner', 'index.mjs');
const leadRunnerPath = path.join(__dirname, '..', 'lead', 'runner.mjs');

const server = new McpServer({
  name: 'agent-orchestrator',
  version: '0.1.0',
});

const ctx = { repoRoot, stateRoot, runnerPath, leadRunnerPath };

registerDoctorTool(server, ctx);
registerTaskLaunchTools(server, ctx);
registerTaskInspectTools(server, ctx);
registerTaskLifecycleTools(server, ctx);
registerLeadRunTools(server, ctx);
registerLeadRunLifecycleTools(server, ctx);

const transport = new StdioServerTransport();
await server.connect(transport);
