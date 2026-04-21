# Contributing

Thanks for your interest in `codex-channels`.

## Project shape

This repository is organized as an npm-first TypeScript monorepo.

Main packages:
- `packages/core` — shared interaction model and runtime primitives
- `packages/backend-local` — local-first HTTP backend
- `packages/backend-slack` — Slack backend scaffold
- `packages/backend-discord` — Discord backend scaffold
- `packages/backend-telegram` — Telegram backend scaffold
- `packages/persistence-file` — file-backed persistence
- `packages/transport-codex-app-server` — Codex app-server transport and bridge primitives
- `packages/cli` — installable CLI surface

## Development workflow

```bash
npm install
npm run check
npm run build
npm test
```

## Contribution guidelines

1. Keep changes small and reviewable.
2. Preserve the local-first and Codex-first product direction.
3. Prefer thin adapters over putting source-specific logic into the core runtime.
4. Add or update tests for functional changes.
5. Update docs when you change the public surface.

## Design constraints

- The core runtime should remain backend-agnostic.
- Remote backends should be optional, not required for baseline usage.
- Codex plugin support is a convenience layer; npm packages remain the primary product surface.

## Pull requests

Please include:
- summary of the change
- verification steps you ran
- any compatibility or migration notes
