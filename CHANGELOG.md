# Changelog

All notable changes to this project should be documented in this file.

## Unreleased

## 0.1.30 - 2026-04-23

- Show the latest overall interaction in operator summaries so recent resolutions remain visible even when the newest actionable item is older.
- Add Hermit writer-fd bridge support and smoke coverage for Codex-compatible Hermit request emission.
- Ignore generated .agent-learner local state directories in the repo.

## 0.1.29 - 2026-04-23

- Show the latest overall interaction in operator summaries so recent resolutions remain visible even when the newest actionable item is older.

- Show the latest overall interaction in operator summaries so recent resolutions remain visible even when the newest actionable item is older.
## 0.1.26 - 2026-04-22

- Make operator flows sandbox-aware by reporting runtime probe failures separately from true unreachability and adding compact update/version guidance to human-facing commands.

## 0.1.25 - 2026-04-22

- Print compact update hints on human-facing commands and include installed/latest version info in `doctor`.
- Add source/kind/id filters to watch, follow, and operator-status so Codex-guided monitoring can be narrowed to one request family.

- Print compact update hints on human-facing commands and include installed/latest version info in `doctor`.
- Add source/kind/id filters to watch and follow so Codex-guided monitoring can be narrowed to one request family.
## 0.1.24 - 2026-04-22

- Add a low-noise `follow` mode plus `channels-follow` shortcut skill so Codex-guided sessions can quietly resolve the next actionable request when reply text is provided.

- Add a low-noise `follow` mode that can resolve the next actionable interaction once it appears when reply text is provided.
## 0.1.23 - 2026-04-22

- Improve `watch` with change-specific next-step hints so low-noise monitoring stays actionable.

- Add a compact next-step hint to watch output so low-noise monitoring also stays actionable.
## 0.1.22 - 2026-04-22

- Improve `watch` with change-specific summaries so low-noise monitoring reports what changed instead of repeating generic updates.

- Improve watch mode with change-specific summaries instead of a generic change banner.
## 0.1.21 - 2026-04-22

- Add a low-noise `watch` mode plus `channels-watch` shortcut skill so Codex-guided sessions only surface meaningful state changes.

- Add a low-noise `watch` mode that prints the first summary immediately and then only reports meaningful state changes.
## 0.1.20 - 2026-04-22

- Quote `[CODEX-CHANNELS]` skill descriptions so Codex can parse the installed SKILL.md frontmatter instead of skipping the shortcut skills.

## 0.1.19 - 2026-04-22

- Install shortcut skills like `operator-status` and `next-step` into the canonical Codex skill root so users can discover key actions without relying on subcommand arguments.
## 0.1.18 - 2026-04-22

- Add `next-step` as a state-based operator action router for Codex-guided local runtime flows.

- Add `next-step` as a state-based operator action router for Codex-guided local runtime flows.
## 0.1.17 - 2026-04-22

- Make `operator-status` human-readable by default, with `--json` as the machine-readable fallback.

- Make `operator-status` human-readable by default, with `--json` as the machine-readable fallback.
## 0.1.16 - 2026-04-22

- Add `operator-status` as a one-shot operator summary for Codex-guided local runtime flows.

- Add `operator-status` as a one-shot operator summary for Codex-guided local runtime flows.
## 0.1.15 - 2026-04-22

- Make the `codex-channels` skill execution-first for obvious subcommand intents like doctor, demo, pending, and reply-latest.

- Make the `codex-channels` skill execution-first for obvious subcommand intents like doctor, demo, pending, and reply-latest.
## 0.1.14 - 2026-04-22

- Make the `codex-channels` skill itself more workflow-oriented so Codex defaults to doctor/pending/demo/reply-latest guidance instead of only restating command lists.

- Make the `codex-channels` skill itself more workflow-oriented so Codex defaults to doctor/pending/demo/reply-latest guidance instead of only restating command lists.
- Prefer `pending` and `reply-latest` in doctor/demo guidance so the Codex-guided operator flow defaults to actionable commands first.
## 0.1.13 - 2026-04-22

- Add guided local-loop commands (`pending`, `reply-latest`) so Codex sessions can operate the local interaction flow with less shell ceremony.

- Add guided local-loop commands (`pending`, `reply-latest`) so Codex sessions can operate the local interaction flow with less shell ceremony.
## 0.1.12 - 2026-04-22

- Install a canonical Codex skill during `plugin-bootstrap` so Codex CLI can see `codex-channels` even when local plugin marketplaces are not surfaced.

- Install a canonical Codex skill during `plugin-bootstrap` so Codex CLI can see `codex-channels` even when local plugin marketplaces are not surfaced.
## 0.1.11 - 2026-04-22

- Add an interactive CLI update checker/updater with arrow-key menu choices for update now, skip once, and skip until next version.
- Reuse the same arrow-key menu UX for `plugin-bootstrap` scope selection while keeping non-interactive defaults safe.

- Add an interactive CLI update checker/updater with arrow-key menu choices for update now, skip once, and skip until next version.
- Reuse the same arrow-key menu UX for `plugin-bootstrap` scope selection while keeping non-interactive defaults safe.

## 0.1.10 - 2026-04-22

- Publish the user-scope-first bootstrap behavior in the CLI package.
- Make no-arg `plugin-bootstrap` safe for global installs by defaulting to user scope and generating a proper plugin root.

## 0.1.9 - 2026-04-22

- Remove tracked TypeScript build cache files and force clean workspace rebuilds before packaging.
- Keep the fixed GitHub Actions tarball publish flow and the first-run command surface intact.

## 0.1.8 - 2026-04-22

- Re-cut the published package set after the CLI install path remained broken on the previous version.
- Keep the fixed GitHub Actions tarball publish flow and the first-run command surface intact.

## 0.1.7 - 2026-04-21

- Publish packed tarballs as explicit file paths in GitHub Actions so npm does not misread them as package specs.
- Preserve the clean-run packaging fix, stale `tsbuildinfo` cleanup, and CLI `submit` flow in the released package set.

## 0.1.6 - 2026-04-21

- Publish the exact packed tarballs from GitHub Actions so the npm artifacts match the verified `pack:preview` outputs.
- Preserve the clean-run packaging fix, stale `tsbuildinfo` cleanup, and CLI `submit` flow in the released package set.

## 0.1.5 - 2026-04-21

- Publish from each workspace directory in GitHub Actions so the release tarballs keep compiled `dist/` outputs.
- Preserve the clean-run packaging fix, stale `tsbuildinfo` cleanup, and CLI `submit` flow in the released package set.

## 0.1.4 - 2026-04-21

- Fix workspace build packaging so clean builds regenerate `dist/` outputs before pack/publish flows.
- Stop tracking stale `tsconfig.tsbuildinfo` artifacts that could make release tarballs miss compiled files.
- Add a CLI `submit` flow for a single publish-and-wait interaction roundtrip.

## 0.1.3 - 2026-04-21

- Rename the published CLI package to `@cafitac/codex-channels`
- Cut a fresh patch release after npm rejected the unscoped package name

## 0.1.2 - 2026-04-21

- Add local preflight commands for CI and release verification
- Cut a fresh release candidate from the latest green main branch after the v0.1.1 tag

## 0.1.1 - 2026-04-21

- Fix CI/release TypeScript resolution on clean runners
- Separate source-only typecheck config from build-time config
- Preserve release and publish readiness for the fixed main branch

## 0.1.0 - 2026-04-21

See also: `docs/releases/v0.1.0.md`

Initial OSS scaffold:
- npm-first TypeScript monorepo
- core interaction runtime
- local HTTP runtime and file-backed persistence
- Codex app-server bridge primitives
- stdio and spawned bridge CLI modes
- Slack, Discord, and Telegram backend scaffolds
- Codex plugin wrapper and bootstrap tooling
