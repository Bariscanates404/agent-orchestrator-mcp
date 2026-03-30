# Agent Orchestrator MCP

Reusable MCP server for running Claude Code and Codex CLI workers as parallel coding agents across multiple repositories.

## Purpose

This project is the shared orchestration layer.
It should live outside any single application repo.

It can:
- launch `claude` or `codex` worker tasks
- isolate coding tasks with `git worktree`
- persist logs and task state under `~/.codex/agent-orchestrator`
- let a lead agent inspect, cancel, and clean up worker tasks
- persist task/event history in local SQLite for watcher UIs
- expose a local watcher screen for live task monitoring
- run multi-round lead orchestration (plan → execute → evaluate)

## Architecture

Feature-sliced modular structure — 61 modules under `src/` + `bin/`:

```
agent-orchestrator-mcp/
  bin/                          Thin 2-line entry points
    server.mjs                  MCP server
    runner.mjs                  Task runner subprocess
    lead-runner.mjs             Lead runner subprocess
    watcher.mjs                 HTTP dashboard server
    doctor.mjs / smoke.mjs      Health check / smoke test
    dashboard.mjs               TUI dashboard
    demo-claude-batch.mjs       Demo script

  src/
    shared/                     Cross-cutting modules
      constants.mjs             Status enums, terminal states, event types, verdicts
      time.mjs                  nowIso()
      mcp-result.mjs            toTextResult(), unwrapToolResult()
      spawn-detached.mjs        Detached subprocess helper
      settings.mjs              getRuntimeSettings()
      db-scope.mjs              withDb() open-try-finally-close helper

    db/                         SQLite layer (split from original 634-line db.mjs)
      schema.mjs                openDb(), ensureColumn(), DDL
      tasks.mjs                 upsertTask, getTaskById, listTasksForRepo, getTaskStatusCounts
      events.mjs                insertTaskEvent, listTaskEvents, listRepoEvents
      lead-runs.mjs             upsertLeadRun, getLeadRunById, listLeadRunsForRepo
      lead-run-items.mjs        upsertLeadRunItem, listLeadRunItems, getLeadRunItemsByStatus
      lead-run-events.mjs       insertLeadRunEvent, listLeadRunEvents
      settings.mjs              getSettings, updateSettings
      index.mjs                 Barrel re-export

    lib/                        Domain-agnostic utilities
      paths.mjs                 resolveRepoRoot, resolveStateRoot, buildTaskPaths, taskFilePath
      git.mjs                   gitCommand, getGitOverview
      backend.mjs               detectBackend, discoverBackends
      text.mjs                  shortenText, summarizePrompt, sanitizeName
      ids.mjs                   makeTaskId, repoSlug
      fs.mjs                    readJson, writeJsonAtomic, pathExists, readTail
      process.mjs               runCommand, requireCommand, spawnAndWait
      parse-output.mjs          parseClaudeResult, parseCodexResult
      tasks.mjs                 getTaskSummary, buildDashboardState
      index.mjs                 Barrel re-export

    server/                     MCP server (split from original 1069-line server.mjs)
      index.mjs                 McpServer setup + tool registration + transport
      tools/
        doctor.mjs              orchestrator_doctor
        task-launch.mjs         launch_agent_task, launch_agent_batch
        task-inspect.mjs        get_agent_task, list_agent_tasks, get_dashboard_snapshot
        task-lifecycle.mjs      escalate_agent_task, cancel_agent_task, cleanup_agent_task
        lead-run.mjs            create_lead_run, get_lead_run, list_lead_runs
        lead-run-lifecycle.mjs  pause/resume/cancel_lead_run, add_lead_run_item

    runner/                     Task runner subprocess
      index.mjs                 main() + signal handlers
      agents.mjs                buildClaudeArgs, buildCodexArgs
      worktree.mjs              prepareWorktree
      streams.mjs               bindProcessStreams, closeStreams

    lead/                       Lead runner subprocess (plan → execute → evaluate)
      runner.mjs                main() 3-phase loop
      prompts.mjs               composePlannerPrompt, composeEvaluatorPrompt
      execution.mjs             executeItems, launchWorkerAndWaitForResult
      pause.mjs                 checkPaused, waitWhilePaused

    watcher/                    HTTP dashboard server
      server.mjs                http.createServer + Router + route dispatch
      routes/
        dashboard.mjs           GET /, /api/dashboard, /api/settings
        tasks.mjs               /api/tasks/* endpoints
        leads.mjs               /api/leads/* endpoints
        stream.mjs              GET /api/stream (SSE)
      http-helpers.mjs          sendJson, sendHtml, sendSse, readBody
      payloads.mjs              buildDashboardPayload, buildLeadRunsPayload
      mcp-proxy.mjs             withOrchestratorClient + proxy functions

    client/                     MCP client helper
      index.mjs                 connectOrchestratorClient, closeOrchestratorClient

    cli/                        CLI scripts
      doctor.mjs / smoke.mjs    Health check / integration test
      dashboard.mjs             TUI dashboard
      demo-claude-batch.mjs     Demo batch launch

  public/
    index.html                  Dashboard UI

  examples/
    claude-project.mcp.json     Example Claude project config
    vscode-mcp.json             Example VS Code config
```

## Commands

```bash
npm install
npm run doctor          # Health check
npm run smoke           # Integration smoke test
npm run dashboard       # TUI dashboard
npm run demo:claude     # Demo Claude batch launch
npm run watch           # HTTP dashboard on :4317
npm start               # Start MCP server (stdio)
```

## Quality Gates

- **Biome.js** for linting + formatting — single quotes, trailing commas, semicolons, 120 char width
- **Pre-commit hook** via `simple-git-hooks` + `lint-staged` — auto-runs `biome check --write` on staged `.mjs` files
- Run `npm run check` to verify lint status, `npm run lint:fix` to auto-fix

## Runtime Policy

- Lead backend preference is stored in SQLite and shown in the watcher UI
- Default worker backend should normally be `claude`
- If a task explicitly requests `codex` and Codex is unavailable, fallback can route it to `claude`

## Watcher UI

Start the watcher:

```bash
TEAMLEAD_REPO_ROOT=/absolute/path/to/project npm run watch
```

Then open:

```text
http://localhost:4317
```

The first screen lets you choose:
- lead developer/orchestrator backend
- default worker backend
- Codex fallback backend

The watcher can also:
- launch ad-hoc worker tasks from the browser
- show live per-task stdout/stderr/status events over SSE
- cancel or clean up tasks
- escalate a Claude task into a Codex task while preserving parent task linkage
- manage lead runs (create, pause, resume, cancel, add items)

The watcher stores everything in local SQLite:
- DB file: `~/.codex/agent-orchestrator/orchestrator.db`
- Task files/logs/reports: `~/.codex/agent-orchestrator/<repo-slug>/...`

Useful options:

```bash
ORCHESTRATOR_WATCHER_PORT=4318 TEAMLEAD_REPO_ROOT=/absolute/path/to/project npm run watch
```

## Consumer Project Config

### VS Code workspace `.vscode/mcp.json`

```json
{
  "servers": {
    "agent-orchestrator": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/Users/bariscanates/tbproject/agent-orchestrator-mcp/bin/server.mjs"
      ],
      "env": {
        "TEAMLEAD_REPO_ROOT": "${workspaceFolder}",
        "TEAMLEAD_STATE_ROOT": "${userHome}/.codex/agent-orchestrator"
      }
    }
  }
}
```

### Claude project `.mcp.json`

```json
{
  "mcpServers": {
    "agent-orchestrator": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/Users/bariscanates/tbproject/agent-orchestrator-mcp/bin/server.mjs"
      ],
      "env": {
        "TEAMLEAD_REPO_ROOT": "/absolute/path/to/project",
        "TEAMLEAD_STATE_ROOT": "/Users/bariscanates/.codex/agent-orchestrator"
      }
    }
  }
}
```

> **Note:** Root `server.mjs` is kept as a backward-compatible wrapper for existing configs.
> New configs should use `bin/server.mjs` as the canonical entry point.

### Codex global MCP

The Codex global registration should point to this project, not to any app repo.
The target repo is resolved from the client session cwd unless `TEAMLEAD_REPO_ROOT` is explicitly set.

## Safety Rule

Use `git_worktree` for code-writing tasks.
If the target repository is dirty, isolated launches fail by default.
