# Codex Plugin Installation

`codex-channels` is **npm-first**, but this repository also ships a Codex plugin wrapper so Codex can discover the local bridge command and the chat-facing skill surface.

## What the plugin wrapper includes

## Fastest path

```bash
npm install
npm run build
npm run plugin:bootstrap
```


- `.codex-plugin/plugin.json` — plugin manifest
- `.mcp.json` — local MCP wiring for `bridge-stdio`
- `skills/codex-channels/SKILL.md` — Codex chat-facing guidance

## Important prerequisites

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

You can generate the marketplace entry with the CLI:

```bash
node packages/cli/dist/index.js plugin-bootstrap --scope workspace
```

For user-level installation:

```bash
node packages/cli/dist/index.js plugin-bootstrap --scope user
```

The command also accepts:
- `--plugin-path <path>`
- `--marketplace-file <path>`

Use those when you want to target a non-default marketplace location or plugin path.

## Local workspace installation

From the repository root, create a workspace-local plugin marketplace entry.

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

If you want the plugin available across workspaces, symlink the repository into a stable path and point the user-level marketplace entry to that path.

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
