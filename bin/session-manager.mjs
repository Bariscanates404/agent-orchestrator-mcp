#!/usr/bin/env node
/**
 * Session Manager for Agent Orchestrator
 *
 * Usage:
 *   node bin/session-manager.mjs save          -- Save current session state
 *   node bin/session-manager.mjs shutdown       -- Graceful shutdown (save + stop watcher)
 *   node bin/session-manager.mjs auto-shutdown  -- Auto-shutdown after idle timeout (default 60min)
 *   node bin/session-manager.mjs restore        -- Show last saved session info
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = path.join(process.env.HOME || '/tmp', '.codex', 'agent-orchestrator', 'session-state.json');
const BASE_URL = `http://localhost:${process.env.ORCHESTRATOR_WATCHER_PORT || 4317}`;
const IDLE_TIMEOUT_MS = Number(process.env.AUTO_SHUTDOWN_MINS || 60) * 60 * 1000;

async function fetchJson(endpoint) {
  const resp = await fetch(`${BASE_URL}${endpoint}`);
  if (!resp.ok) throw new Error(`${endpoint}: ${resp.status}`);
  return resp.json();
}

async function saveSession() {
  let dashboard, leads, settings;
  try {
    [dashboard, leads, settings] = await Promise.all([
      fetchJson('/api/dashboard'),
      fetchJson('/api/leads'),
      fetchJson('/api/settings'),
    ]);
  } catch (e) {
    console.error(`Watcher not reachable: ${e.message}`);
    return null;
  }

  const activeTasks = (dashboard.tasks || []).filter((t) => ['running', 'queued', 'preparing'].includes(t.status));
  const activeLeads = (leads.runs || []).filter((r) => !['completed', 'failed', 'cancelled'].includes(r.status));

  const session = {
    savedAt: new Date().toISOString(),
    port: Number(process.env.ORCHESTRATOR_WATCHER_PORT || 4317),
    repoRoot: dashboard.repoRoot || null,
    stats: dashboard.counts || {},
    settings: {
      leadBackend: settings.leadBackend || 'claude',
      defaultWorkerBackend: settings.defaultWorkerBackend || 'claude',
      codexFallbackBackend: settings.codexFallbackBackend || 'claude',
    },
    activeTasks: activeTasks.map((t) => ({
      id: t.id,
      label: t.label,
      status: t.status,
      backend: t.backend,
      createdAt: t.createdAt,
    })),
    activeLeadRuns: activeLeads.map((r) => ({
      id: r.id,
      label: r.label,
      status: r.status,
      phase: r.phase,
      objective: r.objective?.substring(0, 200),
    })),
    totalTasks: (dashboard.tasks || []).length,
    totalLeadRuns: (leads.runs || []).length,
  };

  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
  console.log(`Session saved to ${SESSION_FILE}`);
  console.log(
    `  Active tasks: ${activeTasks.length}, Active leads: ${activeLeads.length}, Total tasks: ${session.totalTasks}`,
  );
  return session;
}

async function shutdown() {
  console.log('Saving session before shutdown...');
  await saveSession();

  console.log('Finding watcher process...');
  try {
    const { execSync } = await import('node:child_process');
    const pids = execSync(`lsof -ti :${process.env.ORCHESTRATOR_WATCHER_PORT || 4317}`, { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);
    for (const pid of pids) {
      console.log(`  Stopping PID ${pid}...`);
      process.kill(Number(pid), 'SIGTERM');
    }
    console.log('Watcher stopped.');
  } catch {
    console.log('No watcher process found or already stopped.');
  }
}

async function autoShutdown() {
  const mins = IDLE_TIMEOUT_MS / 60000;
  console.log(`Auto-shutdown enabled. Will shutdown after ${mins} minutes of idle.`);
  console.log(`Checking every 60 seconds...`);

  let lastActiveTime = Date.now();

  const check = async () => {
    try {
      const dashboard = await fetchJson('/api/dashboard');
      const activeTasks = (dashboard.tasks || []).filter((t) => ['running', 'queued', 'preparing'].includes(t.status));

      if (activeTasks.length > 0) {
        lastActiveTime = Date.now();
        const remaining = Math.round((IDLE_TIMEOUT_MS - (Date.now() - lastActiveTime)) / 60000);
        console.log(`[${new Date().toLocaleTimeString()}] ${activeTasks.length} active task(s). Timer reset.`);
      } else {
        const idleMs = Date.now() - lastActiveTime;
        const remainingMins = Math.round((IDLE_TIMEOUT_MS - idleMs) / 60000);
        if (idleMs >= IDLE_TIMEOUT_MS) {
          console.log(`Idle timeout reached (${mins} mins). Shutting down...`);
          await shutdown();
          process.exit(0);
        }
        console.log(`[${new Date().toLocaleTimeString()}] Idle. Shutdown in ~${remainingMins} min.`);
      }
    } catch (e) {
      console.log(`[${new Date().toLocaleTimeString()}] Watcher unreachable: ${e.message}. Exiting.`);
      process.exit(1);
    }
  };

  await check();
  setInterval(check, 60000);
}

function restore() {
  if (!fs.existsSync(SESSION_FILE)) {
    console.log('No saved session found.');
    return;
  }
  const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  console.log('=== Last Saved Session ===');
  console.log(`Saved at: ${session.savedAt}`);
  console.log(`Port: ${session.port}`);
  console.log(`Repo: ${session.repoRoot}`);
  console.log(`Total tasks: ${session.totalTasks}, Total leads: ${session.totalLeadRuns}`);
  console.log(`\nSettings:`);
  console.log(`  Lead: ${session.settings.leadBackend}, Worker: ${session.settings.defaultWorkerBackend}`);
  if (session.activeTasks.length > 0) {
    console.log(`\nActive Tasks (at save time):`);
    for (const t of session.activeTasks) {
      console.log(`  - [${t.status}] ${t.label} (${t.backend}) ID: ${t.id}`);
    }
  }
  if (session.activeLeadRuns.length > 0) {
    console.log(`\nActive Lead Runs (at save time):`);
    for (const r of session.activeLeadRuns) {
      console.log(`  - [${r.status}/${r.phase}] ${r.label} ID: ${r.id}`);
      if (r.objective) console.log(`    Objective: ${r.objective}`);
    }
  }
  console.log(`\nTo restart: cd ${session.repoRoot} && env -u CLAUDECODE npm run watch`);
}

const command = process.argv[2] || 'save';
switch (command) {
  case 'save':
    await saveSession();
    break;
  case 'shutdown':
    await shutdown();
    break;
  case 'auto-shutdown':
    await autoShutdown();
    break;
  case 'restore':
    restore();
    break;
  default:
    console.error(`Unknown command: ${command}. Use: save | shutdown | auto-shutdown | restore`);
    process.exit(1);
}
