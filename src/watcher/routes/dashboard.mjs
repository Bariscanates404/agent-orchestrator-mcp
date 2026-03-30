import fs from 'node:fs/promises';
import path from 'node:path';
import { openDb, updateSettings } from '../../db/index.mjs';
import { discoverBackends, ensureRepoStatePaths, getGitOverview, readWorkspace } from '../../lib/index.mjs';
import { getRuntimeSettings } from '../../shared/settings.mjs';
import { readBody, sendHtml, sendJson } from '../http-helpers.mjs';
import { buildDashboardPayload } from '../payloads.mjs';

export function registerDashboardRoutes(router, { publicDir, repoRoot, stateRoot }) {
  router.get('/', async (_req, res) => {
    const html = await fs.readFile(path.join(publicDir, 'index.html'), 'utf8');
    return sendHtml(res, html);
  });

  router.get('/api/settings', (_req, res) => {
    return sendJson(res, 200, getRuntimeSettings(stateRoot));
  });

  router.post('/api/settings', async (req, res) => {
    const body = await readBody(req);
    const db = openDb(stateRoot);
    try {
      updateSettings(db, {
        leadBackend: body.leadBackend,
        defaultWorkerBackend: body.defaultWorkerBackend,
        codexFallbackBackend: body.codexFallbackBackend,
      });
    } finally {
      db.close();
    }
    return sendJson(res, 200, { ok: true, settings: getRuntimeSettings(stateRoot) });
  });

  router.get('/api/dashboard', (_req, res, url) => {
    return sendJson(res, 200, buildDashboardPayload(repoRoot, stateRoot, Number(url.searchParams.get('limit') || 40)));
  });

  router.get('/api/plugins', async (_req, res) => {
    const plugins = [];
    // Read .mcp.json from the repo root (agent-orchestrator-mcp project)
    const mcpPath = path.join(repoRoot, '.mcp.json');
    try {
      const raw = await fs.readFile(mcpPath, 'utf8');
      const mcpConfig = JSON.parse(raw);
      const servers = mcpConfig.mcpServers || {};
      for (const [name, config] of Object.entries(servers)) {
        plugins.push({
          name,
          command: config.command || null,
          args: config.args || [],
          env: config.env || {},
          active: true,
        });
      }
    } catch {
      // .mcp.json not found or invalid — return empty list
    }
    return sendJson(res, 200, { plugins });
  });

  router.get('/api/workspace', async (_req, res, url) => {
    const wsPath = url.searchParams.get('path');
    if (!wsPath) {
      return sendJson(res, 400, { error: 'path query parameter is required' });
    }
    // Security: only allow reading from .orchestrator-sessions directories
    const normalized = path.resolve(wsPath);
    if (!normalized.includes('.orchestrator-sessions')) {
      return sendJson(res, 403, { error: 'Access denied: only workspace files can be read' });
    }
    try {
      const data = await readWorkspace(normalized);
      return sendJson(res, 200, data);
    } catch (e) {
      return sendJson(res, 404, { error: 'Workspace not found: ' + e.message });
    }
  });

  router.get('/api/doctor', async (_req, res) => {
    const [backends, git, dirs] = await Promise.all([
      discoverBackends(),
      getGitOverview(repoRoot),
      ensureRepoStatePaths(repoRoot, stateRoot),
    ]);
    return sendJson(res, 200, { repoRoot, stateRoot, dirs, git, backends });
  });
}
