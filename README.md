# 🤖 Agent Orchestrator MCP

> An MCP server that runs **Claude Code** and **Codex CLI** as parallel coding agents, isolated in git worktrees, coordinated by a lead planner agent, and observable from a live dashboard.

![Node](https://img.shields.io/badge/node-%E2%89%A522.5-3c873a)
![MCP](https://img.shields.io/badge/Model%20Context%20Protocol-server-6e56cf)
![Style](https://img.shields.io/badge/style-Biome-60a5fa)
![License](https://img.shields.io/badge/license-MIT-green)

Agent Orchestrator MCP turns your terminal coding agents into a small autonomous team. A **lead** agent breaks a goal into tasks, **worker** agents (Claude or Codex) execute them in parallel inside isolated `git worktree`s, and everything (logs, status, events) is persisted locally in SQLite and streamed to a browser dashboard in real time.

It speaks the [Model Context Protocol](https://modelcontextprotocol.io), so any MCP client (Claude Code, VS Code, and others) can drive it.

## ✨ Why

Running one coding agent at a time is slow, and running several by hand is chaos: clashing branches, lost logs, no overview. This server gives you:

- **Parallelism without conflicts.** Each task runs in its own `git worktree`, so agents never step on each other.
- **A lead/worker loop.** A planner agent decomposes a goal, dispatches workers, evaluates results, and iterates (plan → execute → evaluate).
- **Full observability.** Live per-task stdout/stderr/status over SSE, persisted to SQLite, viewable in a TUI or browser.
- **Backend choice.** Mix Claude Code and Codex workers, with automatic fallback when one is unavailable.

## 🚀 Features

- 🧑‍✈️ **Lead orchestration**: multi-round plan/execute/evaluate runs you can pause, resume, and cancel
- 🌳 **Worktree isolation**: safe parallel edits; dirty-repo launches fail closed by default
- 🔀 **Multi-backend**: `claude` or `codex` per task, with configurable fallback
- 📊 **Live dashboard**: HTTP + SSE watcher UI on `:4317`, plus a terminal TUI
- 🗃️ **Local-first state**: tasks, events, and lead runs in the built-in `node:sqlite`, no external DB
- 🧰 **16 MCP tools**: launch, inspect, escalate, and clean up tasks and lead runs
- 🪶 **No stored secrets**: auth is delegated to the `claude`/`codex` CLIs; the server keeps no API keys

## 🛠 How it works

```
                 ┌─────────────────────────────────────────────┐
   MCP client    │             Agent Orchestrator MCP          │
 (Claude Code,   │                                             │
  VS Code, ...)  │   lead run ──► plan ─► execute ─► evaluate   │
       │         │                          │                   │
       ▼         │                          ▼                   │
   stdio  ◄──────┤   worker tasks  ─►  git worktree (isolated)  │
                 │        │                                      │
                 │        ▼                                      │
                 │   SQLite state  ─►  HTTP + SSE dashboard      │
                 └─────────────────────────────────────────────┘
```

## 📋 Prerequisites

- **Node.js 22.5+** (uses the built-in `node:sqlite`; Node 24+ recommended)
- At least one agent CLI installed and authenticated:
  - [Claude Code](https://claude.com/claude-code) (`claude`)
  - and/or Codex CLI (`codex`)
- `git` (for worktree isolation)

## ⚡ Quick start

```bash
git clone https://github.com/Bariscanates404/agent-orchestrator-mcp.git
cd agent-orchestrator-mcp
npm install

npm run doctor      # verify Node, git, and detected agent backends
npm run watch       # open the dashboard on http://localhost:4317
```

To use it as an MCP server from a client, point the client at `bin/server.mjs` (see below).

## 🔌 Connect an MCP client

### Claude Code / Claude project (`.mcp.json`)

```json
{
  "mcpServers": {
    "agent-orchestrator": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/agent-orchestrator-mcp/bin/server.mjs"],
      "env": {
        "TEAMLEAD_REPO_ROOT": "/absolute/path/to/your/project"
      }
    }
  }
}
```

### VS Code (`.vscode/mcp.json`)

```json
{
  "servers": {
    "agent-orchestrator": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/agent-orchestrator-mcp/bin/server.mjs"],
      "env": {
        "TEAMLEAD_REPO_ROOT": "${workspaceFolder}"
      }
    }
  }
}
```

The target repo is resolved from the client session's working directory unless `TEAMLEAD_REPO_ROOT` is set. State defaults to `~/.codex/agent-orchestrator`.

## 🧰 MCP tools

| Category | Tools |
|---|---|
| Health | `orchestrator_doctor` |
| Tasks | `launch_agent_task`, `launch_agent_batch`, `get_agent_task`, `list_agent_tasks`, `get_dashboard_snapshot` |
| Task lifecycle | `escalate_agent_task`, `cancel_agent_task`, `cleanup_agent_task` |
| Lead runs | `create_lead_run`, `get_lead_run`, `list_lead_runs` |
| Lead lifecycle | `pause_lead_run`, `resume_lead_run`, `cancel_lead_run`, `add_lead_run_item` |

## 📊 Dashboard

```bash
TEAMLEAD_REPO_ROOT=/absolute/path/to/your/project npm run watch
# then open http://localhost:4317
```

From the browser you can pick lead/worker/fallback backends, launch ad-hoc tasks, watch live stdout/stderr/status over SSE, cancel or clean up tasks, escalate a Claude task into a Codex task, and manage lead runs. Everything is stored locally:

- DB: `~/.codex/agent-orchestrator/orchestrator.db`
- Task logs/reports: `~/.codex/agent-orchestrator/<repo-slug>/...`

## ⚙️ Configuration

Copy `.env.example` and adjust as needed (all optional):

| Variable | Default | Purpose |
|---|---|---|
| `ORCHESTRATOR_WATCHER_PORT` | `4317` | Dashboard HTTP port |
| `ORCHESTRATOR_DEFAULT_BACKEND` | `claude` | Default worker backend |
| `ORCHESTRATOR_DEFAULT_LEAD` | `codex` | Default lead/planner backend |
| `ORCHESTRATOR_CODEX_FALLBACK` | `claude` | Fallback when Codex is unavailable |
| `TEAMLEAD_REPO_ROOT` | git-detected | Target repository |
| `TEAMLEAD_STATE_ROOT` | `~/.codex/agent-orchestrator` | State/data directory |

## 🏗 Architecture

Feature-sliced ESM modules under `src/`, with thin `bin/` entry points:

```
bin/        Thin entry points: server, runner, lead-runner, watcher, doctor, dashboard
src/
  shared/   Constants, time, mcp-result, spawn helpers, settings, db-scope
  db/       SQLite layer: tasks, events, lead-runs, lead-run-items, settings
  lib/      Utilities: paths, git, backend detection, output parsing, fs, process
  server/   MCP server + tools/
  runner/   Worker task subprocess: agents, worktree, streams
  lead/     Lead runner: plan → execute → evaluate
  watcher/  HTTP + SSE dashboard: routes, payloads, mcp-proxy
  client/   MCP client helper
public/     Dashboard UI
examples/   Example MCP client configs
```

## 🧑‍💻 Development

```bash
npm run check       # Biome lint
npm run lint:fix    # Biome auto-fix
npm run smoke       # integration smoke test
```

- **ESM only** (`.mjs`), **Biome** for lint/format (single quotes, trailing commas, 120 width, 2-space indent)
- A pre-commit hook (`simple-git-hooks` + `lint-staged`) auto-formats staged files

## 🛡 Safety

Code-writing tasks should use worktree isolation. If the target repository is dirty, isolated launches fail by default, so an agent cannot clobber uncommitted work.

## 🗂 Contents

| Path | Purpose |
| --- | --- |
| `bin/` | Thin entry points: `server`, `runner`, `lead-runner`, `watcher`, `dashboard`, `doctor`, `smoke`, `session-manager`, `demo-claude-batch` |
| `src/` | Feature-sliced implementation (db, server, runner, lead, watcher, client, lib, shared, cli) |
| `public/` | Dashboard UI (`index.html`) |
| `examples/` | Example MCP client configs (Claude project, VS Code) |
| `server.mjs` | Root server entry file |
| `package.json` | Scripts (`start`, `doctor`, `smoke`, `watch`, `dashboard`, `lint`, `session:*`) |
| `.env.example` | Names of supported environment variables (no values) |
| `biome.json` | Lint/format rules |
| `CLAUDE.md` | Notes for AI coding agents working in this repo |
| `LICENSE` | MIT |

## 🧱 Tech stack

Node.js (>= 22.5, ESM only), built-in `node:sqlite`, Model Context Protocol server over stdio, HTTP + Server-Sent Events dashboard, Biome, `simple-git-hooks` + `lint-staged`.

## 📌 Status

Active personal project. Last commit 2026-06-03, 8 commits. Version 0.1.0 (package is marked private, not published to npm).

## 🔗 Related repos

None evident in the repository.


## 📄 License

[MIT](LICENSE) © Barış Can Ateş
