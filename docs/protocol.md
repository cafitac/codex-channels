# Protocol Model

## Shared interaction types

`codex-channels` normalizes interactive work into a small set of kinds:

- `approval_request`
- `permissions_request`
- `user_input_request`
- `elicitation_request`
- `progress_update`
- `resolved`
- `cancelled`
- `errored`

## Interaction contract

An interaction should include:

- stable interaction id
- source identity
- optional Codex thread / turn / request correlation
- user-facing payload
- routing policy metadata
- lifecycle state

## Response contract

A response should include:

- target interaction id
- action (`accept`, `decline`, `cancel`, `text`)
- optional values
- response metadata
- response timestamp

## Mapping philosophy

### Recommended transport split

- **HTTP / CLI for general custom integrations** — if you are wiring a Python, Rust, Java, or other external tool into `codex-channels`, prefer the local HTTP runtime or the CLI commands that sit on top of it.
- **JSON-RPC for the Codex bridge boundary** — JSON-RPC matters when `codex-channels` is translating Codex app-server requests, but it should not be the default requirement for every third-party integration.

### Codex-native request classes

The Codex app-server protocol already contains primitives for:
- command approval
- file change approval
- permissions approval
- tool user input
- MCP elicitation

`codex-channels` should map those into the generic interaction model instead of inventing a parallel semantic layer.

### Backend delivery model

Backends should receive a normalized interaction and remain ignorant of the original app-server or MCP wire protocol.

## Correlation model

At minimum, the runtime should preserve:

- `interaction.id`
- `codex.threadId`
- `codex.turnId`
- `codex.requestId`
- `source.name`

## Lifecycle

1. pending
2. delivered
3. resolved OR cancelled OR errored

The runtime should be able to emit resolution even when a source request is cleared by lifecycle events rather than a user reply.
