# codex-channels

`codex-channels` is a local-first interaction runtime for Codex. It is designed for the missing layer between Codex as the **primary agent** and external runtimes or MCP servers that need to request approvals, permissions, user input, or elicitation.

Most current Codex integrations treat Codex as a worker, an MCP server, or a remote backend. `codex-channels` is aimed at the opposite direction: keeping Codex in the driver's seat while routing interactive requests through pluggable channels such as a local runtime, Slack, Discord, or Telegram.

## At a glance

- **What it is**: a Codex-first interaction runtime for approvals, permissions, user input, and elicitation
- **Default path**: local-first, single-machine, no SaaS required
- **Main surfaces**: npm packages + CLI, with an optional Codex plugin wrapper
- **Current best use case**: give an external runtime or bridge a reusable way to ask the human something while Codex stays the main agent
- **Status**: early, but the local runtime / CLI / Codex bridge path are all usable now

## Most important use case

The most important way to think about `codex-channels` is:

> **use it from inside Codex, not just as a standalone local server**

The standalone CLI is useful for trying the runtime, debugging it, or
integrating a third-party tool. But the higher-value path is:

1. install `codex-channels`
2. register the local plugin / MCP wrapper with Codex
3. let Codex surface approvals, user input, or other interaction flows
   through the `codex-channels` runtime

If you only remember one thing, remember that `codex-channels` is meant
to make **Codex-side human interaction** easier.

## Quickstart

### Install from npm

```bash
npm install -g @cafitac/codex-channels
codex-channels plugin-bootstrap
```

This now installs a Codex-visible `codex-channels` skill set into the
canonical Codex skill root (including shortcut skills such as
`operator-status`, `next-step`, and `channels-watch`) as well as generating the plugin
wrapper and MCP surface. Then restart Codex so it can reload both surfaces.

If you run `plugin-bootstrap` in an interactive shell, it now uses an
arrow-key menu so you can choose between user-level and workspace-local
installation with Enter. For most global installs, user-level is the
recommended default.

### Try it inside Codex first

After bootstrap, Codex should be able to discover the `codex-channels`
plugin/skill surface.

If you want to confirm the runtime manually first, run:

```bash
codex-channels operator-status
codex-channels watch
codex-channels next-step
codex-channels doctor
codex-channels pending
codex-channels demo
```

`demo` intentionally waits for a real reply so you can see the full
publish → inspect → reply → resolve loop.

### Keep the CLI updated

On the default interactive help screen, the CLI can check for a newer
published npm version and show an arrow-key menu:

- Update now
- Skip
- Skip until next version

You can also trigger the updater directly:

```bash
codex-channels self-update
```

If the CLI is running from a source checkout instead of a published npm
install, `self-update` prints the shortest manual update steps instead of
trying to mutate the checkout automatically.

### Inspect and reply to interactions

```bash
codex-channels pending
codex-channels inspect
codex-channels reply-latest --text staging
# or codex-channels reply --id <interaction-id> --text staging
```

Typical flow:

1. run `codex-channels demo`
2. in another terminal, run `codex-channels pending`
3. reply with `codex-channels reply-latest --text staging`
4. if needed, fall back to `codex-channels inspect` + `reply --id ...`
5. watch the original `demo` command finish with the resolved response

Example:

```bash
# terminal 1
codex-channels demo

# terminal 2
codex-channels inspect --state-file .codex-channels/state.json
codex-channels reply --id demo-1234567890 --text staging --port 4317
```

`demo` waiting after it prints the interaction id is expected behavior.
It only finishes after you send a real reply from another terminal.

### Lower-level runtime / bridge commands

```bash
codex-channels serve --port 4317 --state-file .codex-channels/state.json
codex-channels status --port 4317
codex-channels submit \
  --port 4317 \
  --state-file .codex-channels/state.json \
  --interaction-file ./interaction.json
codex-channels bridge-stdio --port 4317 --state-file .codex-channels/state.json
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

## If you are just trying it

- `doctor` tells you whether the local runtime is already reachable and what command to try next
- `demo` starts a sample interaction and waits for you to answer it from another terminal
- `inspect` shows what interactions currently exist in the local state file
- `reply` sends an answer back to a running local runtime

## If you want to use it from inside Codex

After:

```bash
codex-channels plugin-bootstrap
```

restart Codex.

Then inside Codex, treat `codex-channels` as the interaction layer that
the plugin/bridge can use for:
- approval requests
- free-text user input
- inspect/reply style debugging flows

If you are testing by hand, the easiest companion commands are still:

```bash
codex-channels doctor
codex-channels demo
codex-channels inspect
codex-channels reply --id <interaction-id> --text staging
```

## CLI

```bash
codex-channels doctor
codex-channels self-update
codex-channels demo
codex-channels inspect
codex-channels reply --id <interaction-id> --text staging
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

## Integration model

- **Use HTTP or the CLI for third-party integrations.** If you are writing a Python, Rust, Java, or other custom runtime, the simplest path is the local HTTP surface or CLI commands such as `submit`, `inspect`, and `reply`.
- **Use JSON-RPC only for the Codex bridge layer.** `bridge-stdio` and `bridge-spawn` exist for Codex app-server style integration and are not the recommended default for general custom tools.

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
- [Codex-native interaction roadmap](./docs/codex-native-interaction-roadmap.md)
- [Publishing](./docs/publishing.md)
- [Release checklist](./docs/release-checklist.md)
- [v0.1.9 release notes](./docs/releases/v0.1.9.md)
- [v0.1.10 release notes](./docs/releases/v0.1.10.md)
- [v0.1.11 release notes](./docs/releases/v0.1.11.md)
- [v0.1.12 release notes](./docs/releases/v0.1.12.md)
- [v0.1.13 release notes](./docs/releases/v0.1.13.md)
- [v0.1.14 release notes](./docs/releases/v0.1.14.md)
- [v0.1.15 release notes](./docs/releases/v0.1.15.md)
- [v0.1.16 release notes](./docs/releases/v0.1.16.md)
- [v0.1.17 release notes](./docs/releases/v0.1.17.md)
- [v0.1.18 release notes](./docs/releases/v0.1.18.md)
- [v0.1.19 release notes](./docs/releases/v0.1.19.md)
- [v0.1.20 release notes](./docs/releases/v0.1.20.md)

## License

MIT. See [LICENSE](./LICENSE).
