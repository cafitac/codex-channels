# Codex Install Quickstart

This is the shortest practical path to using `codex-channels` as a local Codex plugin.

## Workspace-local install

From the repository root:

```bash
npm install
npm run build
npm run plugin:bootstrap
```

What this does:
- builds the local CLI
- writes `.agents/plugins/marketplace.json`
- registers the current repository as a local plugin source for Codex

After that:
1. restart Codex
2. let Codex reload local plugins
3. use the `codex-channels` plugin/skill surface

## User-level install

If you want the plugin wrapper available across workspaces:

```bash
npm install
npm run build
npm run plugin:bootstrap:user
```

By default this writes to:
- `~/.agents/plugins/marketplace.json`

You will still need the repository available at the plugin path the marketplace entry points to. If you want a stable user-global path, combine this with a symlink such as:

```bash
mkdir -p ~/plugins
ln -sfn /absolute/path/to/codex-channels ~/plugins/codex-channels
```

Then rerun bootstrap with an explicit path:

```bash
node ./packages/cli/dist/index.js plugin-bootstrap --scope user --plugin-path ./plugins/codex-channels
```

## Verify installation

Check the generated marketplace file and plugin surface:

```bash
cat .agents/plugins/marketplace.json
cat .codex-plugin/plugin.json
cat .mcp.json
```

## Local runtime after install

To run the local runtime yourself:

```bash
npx @cafitac/codex-channels serve --port 4317 --state-file .codex-channels/state.json
```

Or use the local repo build directly:

```bash
node packages/cli/dist/index.js serve --port 4317 --state-file .codex-channels/state.json
```
