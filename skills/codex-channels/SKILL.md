---
name: codex-channels
description: "[CODEX-CHANNELS] Set up or operate the local codex-channels runtime for Codex-first interaction routing."
---

# codex-channels

Use this skill when you want to:
- bootstrap the local Codex integration for this machine or workspace
- run the local runtime health/demo flow
- inspect pending interactions without remembering every CLI flag
- reply to the newest interaction with less shell ceremony
- explain how the local runtime fits into Codex workflows

## Execution-first rule

When the user invokes this skill with an obvious subcommand intent, **run the matching `codex-channels` command first** instead of only explaining it.

Examples:
- `$codex-channels doctor` -> run `codex-channels doctor`, then summarize the result.
- `$codex-channels demo` -> run `codex-channels demo`; if port binding needs approval, request it and continue.
- `$codex-channels pending` -> run `codex-channels pending` first.
- `$codex-channels operator-status` -> run the summary first and use it to choose the next step.
- `$codex-channels next-step` -> run the obvious next operator action when it is safe to do so.
- `$codex-channels reply-latest --text ...` -> run the command first, then summarize what was resolved.
- `$codex-channels reply --id ... --text ...` -> run the targeted reply first.

Only stay explanatory when:
- the user explicitly asks for docs or a summary
- a command would be destructive or materially ambiguous
- missing arguments prevent a safe execution-first interpretation

## Fastest shortcuts

If you want dedicated shortcut skills instead of subcommands, use:
- `$operator-status`
- `$next-step`
- `$channels-doctor`
- `$channels-demo`
- `$channels-pending`
- `$channels-reply-latest`

## Codex operator mode

When invoked from inside Codex, prefer **doing the next operator step** over only restating documentation.

Default workflow:
- If the user asks "what should I do next?", run `codex-channels operator-status` first and summarize the next action.
- If the user asks whether the runtime is ready, run `codex-channels doctor` and summarize the result.
- If the user asks what is waiting, run `codex-channels pending` first and fall back to `inspect` only when deeper detail is needed.
- If the user asks to test the loop, use `codex-channels demo` and then point them toward `pending` and `reply-latest`.
- If the user asks to answer the newest request, prefer `codex-channels reply-latest --text ...` over making them copy an interaction id manually.
- If a step needs a local port bind, explain that approval/escalation is expected for the real runtime path.

## Fastest operator check

For a single run-ready summary, prefer:
```bash
codex-channels operator-status
```

For the next obvious action, prefer:
```bash
codex-channels next-step
```

## Guided operator flow

### 1. Install / expose the skill
```bash
codex-channels plugin-bootstrap
```

### 2. Check the current state
```bash
codex-channels operator-status
codex-channels next-step
codex-channels doctor
codex-channels pending
```

### 3. Generate a real interaction
```bash
codex-channels demo
```

### 4. Inspect what is waiting
```bash
codex-channels pending
codex-channels inspect
```

### 5. Reply
```bash
codex-channels reply-latest --text staging
# or
codex-channels reply --id <interaction-id> --text staging
```

## Common commands
```bash
codex-channels plugin-bootstrap
codex-channels operator-status
codex-channels next-step
codex-channels doctor
codex-channels demo
codex-channels pending
codex-channels inspect
codex-channels reply-latest --text staging
codex-channels reply --id <interaction-id> --text staging
```
