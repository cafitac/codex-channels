---
name: codex-channels
description: Set up or operate the local codex-channels runtime for Codex-first interaction routing.
---

# codex-channels

Use this skill when you want to:
- bootstrap the local Codex integration for this machine or workspace
- demo, inspect, or reply to local interactions
- explain how the local runtime fits into Codex workflows

Common commands:
```bash
codex-channels plugin-bootstrap
codex-channels doctor
codex-channels demo
codex-channels inspect
codex-channels reply --id <interaction-id> --text staging
```

Guidance:
- Prefer the local runtime first unless you explicitly need a remote channel backend.
- Use `plugin-bootstrap` to install the Codex-visible skill plus the plugin wrapper artifacts.
- Use `demo`, `inspect`, and `reply` to verify the end-to-end interaction loop.
