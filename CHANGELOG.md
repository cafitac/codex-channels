# Changelog

All notable changes to this project should be documented in this file.

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
