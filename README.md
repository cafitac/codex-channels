# codex-channels

`codex-channels` is a local-first interaction runtime for Codex. It is designed for the missing layer between Codex as the **primary agent** and external runtimes or MCP servers that need to request approvals, permissions, user input, or elicitation.

Most current Codex integrations treat Codex as a worker, an MCP server, or a remote backend. `codex-channels` is aimed at the opposite direction: keeping Codex in the driver's seat while routing interactive requests through pluggable channels such as a local runtime, Slack, Discord, or Telegram.

## At a glance

- **What it is**: a Codex-first interaction runtime for approvals, permissions, user input, and elicitation
- **Default path**: local-first, single-machine, no SaaS required
- **Main surfaces**: npm packages + CLI, with an optional Codex plugin wrapper
- **Current best use case**: give an external runtime or bridge a reusable way to ask the human something while Codex stays the main agent
- **Status**: early, but the local runtime / CLI / Codex bridge path are all usable now

## Quickstart

### Install from npm

```bash
npm install -g @cafitac/codex-channels
codex-channels serve --port 4317 --state-file .codex-channels/state.json
```

### One-machine local workflow

```bash
codex-channels status --port 4317
codex-channels bridge-stdio --port 4317 --state-file .codex-channels/state.json
```

### Publish one interaction and wait for a reply

```bash
codex-channels submit \
  --port 4317 \
  --state-file .codex-channels/state.json \
  --interaction-file ./interaction.json
```

## Why this exists

Codex already exposes low-level interaction primitives through the app-server protocol, including approvals, permissions requests, user input, and MCP elicitation. What is still missing is a reusable runtime that:

1. receives those interaction requests,
2. persists and routes them,
3. exposes them through a local or remote channel, and
4. returns the user's decision back into the Codex-native flow.

That runtime is the purpose of `codex-channels`.

## Design goals

- **Codex-first**: Codex remains the main agent.
- **Local-first**: the default path works on a single machine with no SaaS dependency.
- **Channel-pluggable**: local, Slack, Discord, Telegram, and future backends share one model.
- **MCP-generic**: not tied to a single MCP server or agent runtime.
- **OSS-friendly**: packageable as npm modules, with reusable contracts and adapters.

## Repository layout

```text
packages/
  core/             Shared interaction model and runtime primitives
  backend-discord/  Discord remote channel backend
  backend-local/    Local-first HTTP backend and runtime surface
  backend-slack/    Slack remote channel backend
  backend-telegram/ Telegram remote channel backend
  transport-codex-app-server/ Codex app-server request/response mapping and live bridge
  cli/              npm-installable CLI package (`codex-channels`)
docs/
  architecture.md
  protocol.md
  security.md
  roadmap.md
```

## Install paths

- **npm first**: main distribution path for local runtime usage and external consumers
- **Codex plugin wrapper**: optional convenience layer for Codex discovery via `.codex-plugin/` + `.mcp.json`

## CLI

```bash
npx @cafitac/codex-channels serve --port 4317 --state-file .codex-channels/state.json
npx @cafitac/codex-channels status --port 4317
npx @cafitac/codex-channels submit --port 4317 --state-file .codex-channels/state.json --interaction-file ./interaction.json
npx @cafitac/codex-channels bridge-stdio --port 4317 --state-file .codex-channels/state.json
npx @cafitac/codex-channels bridge-spawn --port 4317 --state-file .codex-channels/state.json
npx @cafitac/codex-channels plugin-bootstrap --scope workspace
```

## Usage model

- `codex-channels` runs as a local interaction runtime.
- A Codex app-server bridge or higher-level client feeds interaction requests into it.
- `submit` can run a compact one-off publish-and-wait loop for a single interaction.
- `bridge-stdio` can expose the bridge over stdin/stdout while simultaneously hosting the local runtime for user responses.
- `bridge-spawn` can host the local runtime and spawn a Codex app-server-compatible child process for full bridge orchestration.
- A backend delivers those requests to a local UI or a remote channel.
- The first remote backend scaffolds target Slack, Discord, and Telegram.
- The user's decision is returned to the original request source and marked resolved.

## Local release preflight

Before pushing, tagging, or triggering the release workflow, run:

```bash
npm run preflight:release
```

This mirrors the release-critical local checks:
- `npm run check`
- `npm run build`
- `npm test`
- `npm run pack:preview`
- `npm run publish:dry-run`

For a faster developer loop that skips the pack/publish simulation, use:

```bash
npm run preflight:ci
```

## Essential links

- [Architecture](./docs/architecture.md)
- [Protocol model](./docs/protocol.md)
- [Codex install quickstart](./docs/codex-install-quickstart.md)
- [Publishing](./docs/publishing.md)
- [Release checklist](./docs/release-checklist.md)

## License

MIT. See [LICENSE](./LICENSE).
