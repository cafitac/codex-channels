---
name: channels-watch
description: "[CODEX-CHANNELS] Follow runtime state quietly and only surface meaningful changes."
---

# channels-watch

Use this skill when you want low-noise monitoring instead of repeatedly polling by hand. Run the command first and only summarize changes that actually happened. This should report the initial state once, then only emit another summary when runtime reachability, actionable count, latest interaction, or next-step guidance actually changes. Each emitted summary should also include a compact hint with the current best next command.

Preferred command:
```bash
codex-channels watch
```
