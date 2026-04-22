# Codex Install Quickstart

This is the shortest practical path to using `codex-channels` as a local Codex plugin.

## Recommended user install

From any shell:

```bash
npm install -g @cafitac/codex-channels
codex-channels plugin-bootstrap
```

What this does:
- installs the CLI globally
- installs `~/.codex/skills/codex-channels/SKILL.md` (or `$CODEX_HOME/skills/...`) so Codex CLI can see the skill directly
- writes `~/.agents/plugins/marketplace.json` for the legacy/local plugin wrapper path
- generates a user-level `~/plugins/codex-channels` plugin root

When run interactively, `plugin-bootstrap` now shows an arrow-key menu
for user-level vs workspace-local installation. For a global CLI install,
user-level is the recommended default.

After that:
1. restart Codex
2. let Codex reload local plugins
3. use the `codex-channels` plugin/skill surface

## Workspace-local install

If you only want the plugin limited to one repository:

```bash
npm install
npm run build
npm run plugin:bootstrap
```

This writes a workspace `.codex/skills/codex-channels/SKILL.md` so the repository-local Codex session can see the skill, plus a workspace `.agents/plugins/marketplace.json` and local `./plugins/codex-channels` plugin root.

## Verify installation

Check the generated marketplace file and plugin surface:

```bash
cat ~/.agents/plugins/marketplace.json
ls -la ~/plugins/codex-channels
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

## Updating later

The CLI can surface interactive update notices on the default help
screen. Use arrow keys + Enter to choose between updating immediately,
skipping once, or skipping until a newer version is published.

You can also run:

```bash
codex-channels self-update
```

If you are running from a source checkout, the command prints the manual
update path instead of mutating the checkout automatically.

## Guided local loop

For the fastest manual proof after bootstrap:

```bash
codex-channels demo
codex-channels pending
codex-channels reply-latest --text staging
```

`pending` shows only actionable requests, and `reply-latest` lets you close the newest one without copying the id by hand.

## Fastest operator summary

For the quickest Codex-guided check after bootstrap:

```bash
codex-channels operator-status
```

This returns runtime reachability, actionable interaction count, the latest actionable request, and the next best operator command.
