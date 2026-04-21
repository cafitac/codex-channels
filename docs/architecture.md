# Architecture

## Overview

`codex-channels` is a local-first interaction runtime that sits between:

- **Codex** as the primary agent,
- **external MCP servers or agent runtimes** that emit interactive requests, and
- **user-facing channels** that collect decisions.

## High-level flow

1. Codex or a Codex-adjacent bridge receives an interaction-worthy request.
2. An adapter converts that request into the shared `Interaction` model.
3. The runtime registers the interaction and routes it to one backend.
4. A backend presents it to the user.
5. The user responds through that backend.
6. The runtime resolves the interaction and hands the response back to the source adapter.

## Components

### 1. Core (`@cafitac/codex-channels-core`)

Owns:
- interaction model
- response model
- backend contract
- runtime registry

Does not own:
- transport-specific Codex logic
- MCP-server-specific semantics
- channel-specific SDK logic

### 2. Codex transport / bridge

Owns:
- Codex app-server JSON-RPC transport
- thread / turn / request correlation
- mapping Codex-native requests to generic interaction types

### 3. Channel runtime

Owns:
- pending registry
- timeout tracking
- delivery routing
- resolution lifecycle
- audit metadata

### 4. Channel backends

Examples:
- local backend
- Slack backend
- Discord backend
- Telegram backend

Backends should be thin delivery surfaces. They should not own business logic.

### 5. Source adapters

Adapters translate a runtime-specific request model into the generic `Interaction` contract. They are where tool- or runtime-specific semantics belong.

## Design rules

1. **Codex-first**: never demote Codex into a mere worker in the core model.
2. **Local-first**: the local backend must be enough to use the system.
3. **Channel-agnostic**: all backends consume the same interaction contract.
4. **Adapter-isolation**: source-specific logic stays out of the core.
5. **Protocol-isolation**: app-server drift should be absorbed in one transport boundary.

## Initial package map

- `packages/core`
- `packages/backend-discord`
- `packages/backend-local`
- `packages/backend-slack`
- `packages/backend-telegram`
- `packages/transport-codex-app-server`
- `packages/cli`
- future:
  - `packages/transport-codex-app-server`
  - `packages/backend-slack`
  - `packages/backend-discord`
  - `packages/backend-telegram`
  - `packages/examples`
