---
name: codex-channels
description: Set up, explain, or operate the codex-channels local-first interaction runtime for Codex-first workflows. Use when the user wants to run the local runtime, understand the architecture, choose between local/Slack/Telegram/Discord backends, or wire Codex app-server interaction flows into channels.
---

# codex-channels

`codex-channels` is a local-first interaction runtime for Codex. It helps keep Codex as the primary agent while external runtimes and MCP servers route approvals, permissions, user input, and elicitation through pluggable channels.

## Use this skill when
- the user wants to set up `codex-channels`
- the user asks how to run the local channel runtime
- the user wants to compare local vs remote channel backends
- the user wants to understand how Codex app-server interaction requests map into channels
- the user wants installation guidance for the npm package or plugin wrapper
- the user wants to install the local plugin wrapper into a Codex marketplace

## Current local commands

```bash
npm install
npm run build
node packages/cli/dist/index.js serve --port 4317 --state-file .codex-channels/state.json
node packages/cli/dist/index.js status --port 4317
node packages/cli/dist/index.js bridge-stdio --port 4317 --state-file .codex-channels/state.json
node packages/cli/dist/index.js bridge-spawn --port 4317 --state-file .codex-channels/state.json
```

## What exists today
- shared interaction model
- local HTTP channel runtime
- file-backed persistence
- Codex app-server request mapping, live stdio bridge loop, and spawned child bridge mode
- Slack backend scaffold
- Discord backend scaffold
- Telegram backend scaffold
- plugin wrapper for Codex discovery, local MCP wiring, and guidance

## What does not exist yet
- hosted service mode
- Slack backend implementation
- Discord backend implementation
- fully packaged Codex app-server live integration workflow docs

## Guidance rules
- Prefer the local runtime first unless the user explicitly wants remote escalation.
- Treat Slack/Discord/Telegram as optional backends, not the required default.
- If the user asks which install path is best, recommend npm first and plugin second.
- If the user asks about architecture, explain the boundary between core runtime, Codex transport, channel backends, and source adapters.
