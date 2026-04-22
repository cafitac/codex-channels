---
name: codex-channels
description: Set up or operate the local codex-channels runtime for Codex-first interaction routing.
---

# codex-channels

Use this skill when you want to:
- bootstrap the local Codex integration for this machine or workspace
- run the local runtime health/demo flow
- inspect pending interactions without remembering every CLI flag
- reply to the newest interaction with less shell ceremony
- explain how the local runtime fits into Codex workflows

## Guided operator flow

### 1. Install / expose the skill
```bash
codex-channels plugin-bootstrap
```

### 2. Check the current state
```bash
codex-channels doctor
codex-channels pending
```

If the runtime is already up, prefer `pending` first because it shows only actionable requests.

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
codex-channels doctor
codex-channels demo
codex-channels pending
codex-channels inspect
codex-channels reply-latest --text staging
codex-channels reply --id <interaction-id> --text staging
```

Guidance:
- Prefer the local runtime first unless you explicitly need a remote channel backend.
- Use `plugin-bootstrap` to install the Codex-visible skill plus the plugin wrapper artifacts.
- Use `pending` before `inspect` when you only want the actionable requests.
- Use `reply-latest` for the common local loop so you do not have to copy interaction ids by hand.
- Use `demo`, `pending`, and `reply-latest` to verify the end-to-end interaction loop quickly.
- In Codex-guided operator flows, treat `pending` as the default follow-up after `doctor` or `demo`.
