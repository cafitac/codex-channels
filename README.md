# codex-channels

`codex-channels` is a local-first interaction runtime for Codex. It is designed for the missing layer between Codex as the **primary agent** and external runtimes or MCP servers that need to request approvals, permissions, user input, or elicitation.

Most current Codex integrations treat Codex as a worker, an MCP server, or a remote backend. `codex-channels` is aimed at the opposite direction: keeping Codex in the driver's seat while routing interactive requests through pluggable channels such as a local runtime, Slack, Discord, or Telegram.

## Status

Early scaffold / specification-first repository.

Current repository contents:
- TypeScript/npm monorepo skeleton
- local-first core runtime primitives
- local HTTP channel server
- file-backed interaction persistence
- Codex app-server transport mapping package
- first remote backend scaffolds: Slack, Discord, and Telegram
- CLI scaffold (`codex-channels serve`, `codex-channels status`, `codex-channels bridge-stdio`, `codex-channels bridge-spawn`)
- architecture, protocol, security, and roadmap docs

## Design goals

- **Codex-first**: Codex remains the main agent.
- **Local-first**: the default path works on a single machine with no SaaS dependency.
- **Channel-pluggable**: local, Slack, Discord, Telegram, and future backends share one model.
- **MCP-generic**: not tied to a single MCP server or agent runtime.
- **OSS-friendly**: packageable as npm modules, with reusable contracts and adapters.

## Problem statement

Codex already exposes low-level interaction primitives through the app-server protocol, including approvals, permissions requests, user input, and MCP elicitation. What is still missing is a reusable runtime that:

1. receives those interaction requests,
2. persists and routes them,
3. exposes them through a local or remote channel, and
4. returns the user's decision back into the Codex-native flow.

That runtime is the purpose of `codex-channels`.

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

### npm first (recommended)

The primary distribution target is npm. This is the preferred path for:
- local runtime usage
- external adapters or consumers
- CI or daemon-style deployment

### Codex plugin wrapper (optional)

This repository also includes a lightweight Codex plugin wrapper under `.codex-plugin/`.
The plugin is not the core product; it is a Codex-facing convenience layer for discovery and chat-first guidance. The wrapper now includes local MCP wiring through `.mcp.json`, while the npm packages remain the primary product surface.

## Install (scaffold phase)

```bash
npm install
npm run build
npm run plugin:bootstrap
node packages/cli/dist/index.js serve --port 4317 --state-file .codex-channels/state.json
```

## CLI

```bash
npx @cafitac/codex-channels serve --port 4317 --state-file .codex-channels/state.json
npx @cafitac/codex-channels status --port 4317
npx @cafitac/codex-channels bridge-stdio --port 4317 --state-file .codex-channels/state.json
npx @cafitac/codex-channels bridge-spawn --port 4317 --state-file .codex-channels/state.json
npx @cafitac/codex-channels plugin-bootstrap --scope workspace
```

## Planned usage model

- `codex-channels` runs as a local interaction runtime.
- A Codex app-server bridge or higher-level client feeds interaction requests into it.
- `bridge-stdio` can expose the bridge over stdin/stdout while simultaneously hosting the local runtime for user responses.
- `bridge-spawn` can host the local runtime and spawn a Codex app-server-compatible child process for full bridge orchestration.
- A backend delivers those requests to a local UI or a remote channel.
- The first remote backend scaffolds target Slack, Discord, and Telegram.
- The user's decision is returned to the original request source and marked resolved.

## Planned package strategy

- **Primary distribution**: npm packages
- **Optional convenience layer**: Codex plugin wrapper later
- **Consumer model**: external runtimes (for example, future adapters) depend on the core packages rather than reimplementing the Codex interaction bridge

## Why npm first?

This project lives near the Codex app-server, Codex plugins, and channel backends such as Slack/Discord/Telegram. For that ecosystem, a TypeScript/npm-first monorepo keeps packaging, plugin wiring, CLI distribution, and backend integrations aligned.

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

## Documentation

- [Architecture](./docs/architecture.md)
- [Protocol model](./docs/protocol.md)
- [Security notes](./docs/security.md)
- [Roadmap](./docs/roadmap.md)
- [Plugin installation](./docs/plugin-install.md)
- [Codex install quickstart](./docs/codex-install-quickstart.md)
- [Publishing](./docs/publishing.md)
- [Release checklist](./docs/release-checklist.md)
- [v0.1.0 release notes](./docs/releases/v0.1.0.md)
- [v0.1.1 release notes](./docs/releases/v0.1.1.md)
- [v0.1.2 release notes](./docs/releases/v0.1.2.md)
- [v0.1.3 release notes](./docs/releases/v0.1.3.md)
- [v0.1.4 release notes](./docs/releases/v0.1.4.md)
- [Hermit-Agent integration PRD](./docs/hermit-agent-codex-channels-prd.md)
- [Hermit-Agent integration RALPLAN](./docs/hermit-agent-codex-channels-ralplan.md)
- [Hermit-Agent install UX spec](./docs/hermit-agent-codex-channels-install-ux-spec.md)
- [Hermit-Agent implementation spec](./docs/hermit-agent-codex-channels-implementation-spec.md)
- [Hermit-Agent session handoff](./docs/hermit-agent-codex-channels-session-handoff.md)

## License

MIT. See [LICENSE](./LICENSE).
