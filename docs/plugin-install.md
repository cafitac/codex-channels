# Codex Plugin Installation

`codex-channels` is **npm-first**, but this repository also ships a Codex plugin wrapper so Codex can discover the local bridge command and the chat-facing skill surface.

## What the plugin wrapper includes

## Fastest path

```bash
npm install
npm run build
npm run plugin:bootstrap:user
```


- `.codex-plugin/plugin.json` — plugin manifest
- `.mcp.json` — local MCP wiring for `bridge-stdio`
- `skills/codex-channels/SKILL.md` — Codex chat-facing guidance

## Important prerequisites

The Codex-visible skill is installed into the canonical Codex skill root during bootstrap. The plugin wrapper remains a secondary packaging layer for MCP/plugin experiments.

The plugin wrapper assumes you already built the local CLI:

```bash
npm install
npm run build
```

The plugin MCP wiring points to:

```bash
node ./packages/cli/dist/index.js bridge-stdio --quiet --port 4317 --state-file .codex-channels/state.json
```

So the compiled CLI must exist before Codex can launch it.

## Automated bootstrap

The default recommendation is user-level installation so Codex can see
the plugin across workspaces:

```bash
node packages/cli/dist/index.js plugin-bootstrap
```

When run interactively, `plugin-bootstrap` shows an arrow-key menu
for user-level vs workspace-local installation. User-level is the
recommended default for a globally installed CLI.

Workspace-level installation is still available when you only want to
test inside one repository:

```bash
node packages/cli/dist/index.js plugin-bootstrap --scope workspace
```

The command also accepts:
- `--plugin-path <path>`
- `--marketplace-file <path>`

Use those when you want to target a non-default marketplace location or plugin path.

## Update checks and updater UX

The CLI can check for newer published versions on the default
interactive help screen. When an update is available, it presents these
menu choices:

- Update now
- Skip
- Skip until next version

`Skip until next version` is stored in `~/.codex-channels/update-state.json`.
You can re-run the updater explicitly with:

```bash
codex-channels self-update
```

If the command is running from a source checkout, it prints manual update
steps instead of attempting an in-place npm upgrade.

## Local workspace installation

From the repository root, create a workspace-local plugin marketplace entry
only if you explicitly want the plugin limited to that repo.

### 1. Ensure the plugin root exists in the workspace

This repository is already a plugin root because it contains:
- `.codex-plugin/plugin.json`
- `.mcp.json`
- `skills/`

### 2. Create `.agents/plugins/marketplace.json`

```json
{
  "name": "local-workspace",
  "interface": {
    "displayName": "Workspace Plugins"
  },
  "plugins": [
    {
      "name": "codex-channels",
      "source": {
        "source": "local",
        "path": "."
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Coding"
    }
  ]
}
```

If you already have a workspace marketplace file, append the `codex-channels` entry instead of replacing the file.

### 3. Restart Codex

Restart Codex after updating the marketplace so the plugin manifest and MCP wiring are reloaded.

## User-level installation

If you want the plugin available across workspaces, use the user scope.

Example:

```bash
mkdir -p ~/plugins ~/.agents/plugins
ln -sfn /absolute/path/to/codex-channels ~/plugins/codex-channels
```

Then use `~/.agents/plugins/marketplace.json`:

```json
{
  "name": "local",
  "interface": {
    "displayName": "Local Plugins"
  },
  "plugins": [
    {
      "name": "codex-channels",
      "source": {
        "source": "local",
        "path": "./plugins/codex-channels"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Coding"
    }
  ]
}
```

## Notes on the MCP wiring

The plugin wrapper is intentionally thin:

- the **core product** is still the npm runtime and packages
- the plugin wrapper simply tells Codex how to discover:
  - the local bridge command
  - the codex-channels skill

This keeps the repository aligned with the npm-first strategy while still making Codex installation ergonomic.

## Operator shortcut commands

The local runtime loop now includes two convenience commands for Codex-guided use:

- `codex-channels pending` — show actionable interactions newest-first
- `codex-channels reply-latest --text ...` — reply to the newest actionable interaction without copying the id

- `codex-channels operator-status` — one-shot summary of runtime reachability, pending work, and the next operator step

Use `codex-channels operator-status --json` when you want the same summary in a machine-readable shape.
