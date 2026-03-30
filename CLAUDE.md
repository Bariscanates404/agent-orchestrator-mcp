# Agent Orchestrator MCP

## Architecture

Feature-sliced modular structure under `src/`:

```
src/
  shared/     Cross-cutting: constants, time, mcp-result, spawn-detached, settings, db-scope
  db/         SQLite layer: schema, tasks, events, lead-runs, lead-run-items, lead-run-events, settings
  lib/        Domain-agnostic utils: paths, git, backend, text, ids, fs, process, parse-output, tasks
  server/     MCP server + tools/ (doctor, task-launch, task-inspect, task-lifecycle, lead-run, lead-run-lifecycle)
  runner/     Task runner subprocess: agents, worktree, streams
  lead/       Lead runner: prompts, execution, pause, runner
  watcher/    HTTP dashboard: routes/{dashboard,tasks,leads,stream}, http-helpers, payloads, mcp-proxy
  client/     MCP client helper
  cli/        CLI scripts: doctor, dashboard, smoke, demo-claude-batch
bin/          Thin 2-line entry points
public/       Dashboard UI (index.html)
examples/     Example MCP configs
```

## Conventions

- **ESM only** — all files are `.mjs`, `"type": "module"` in package.json
- **Biome** for linting + formatting — run `npm run check` before committing
- **Single quotes**, **trailing commas**, **semicolons**, 120 char line width, 2-space indent
- **No bare string literals** for statuses — use `TASK_STATUS`, `LEAD_STATUS`, `TASK_TERMINAL_STATES`, `LEAD_TERMINAL_STATES` from `src/shared/constants.mjs`
- **`nowIso()`** instead of `new Date().toISOString()` — import from `src/shared/time.mjs`
- **`toTextResult()` / `unwrapToolResult()`** from `src/shared/mcp-result.mjs` — never duplicate
- **`spawnDetached()`** from `src/shared/spawn-detached.mjs` for all detached subprocess spawning
- **`withDb(stateRoot, fn)`** from `src/shared/db-scope.mjs` for open-try-finally-close patterns
- **Barrel exports** — import from `../db/index.mjs` or `../lib/index.mjs`, not individual sub-modules (except when needed for circular dep avoidance)

## Key Paths

- MCP server entry: `src/server/index.mjs` (or `bin/server.mjs`)
- Runner subprocess: `src/runner/index.mjs`
- Lead runner subprocess: `src/lead/runner.mjs`
- Watcher HTTP server: `src/watcher/server.mjs`
- SQLite DB: `~/.codex/agent-orchestrator/orchestrator.db`
- Backward-compat wrapper: `server.mjs` (root) → `src/server/index.mjs`

## npm Scripts

- `npm start` — start MCP server
- `npm run watch` — start HTTP dashboard on :4317
- `npm run doctor` — health check
- `npm run smoke` — integration smoke test
- `npm run lint` — biome check
- `npm run lint:fix` — biome auto-fix
- `npm run check` — biome check (alias)

## Adding a New MCP Tool

1. Create `src/server/tools/my-tool.mjs` with `export function registerMyTool(server, ctx) { ... }`
2. Register in `src/server/index.mjs`
3. If it needs watcher HTTP endpoint, add route in `src/watcher/routes/`

## Adding a New DB Table

1. Add DDL in `src/db/schema.mjs` `openDb()` function
2. Create `src/db/my-table.mjs` with CRUD functions
3. Export from `src/db/index.mjs`
