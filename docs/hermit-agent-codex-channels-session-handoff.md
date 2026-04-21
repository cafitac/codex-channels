# Session Handoff — Hermit-Agent × Codex-Channels Integration

## What already exists in codex-channels

### Runtime
- local HTTP runtime
- file-backed persistence
- interaction registry and publish/resolve/wait flow

### Codex bridge
- interactive request mapping
- stdio bridge
- spawned bridge mode
- plugin wrapper + `.mcp.json`
- plugin bootstrap command
- local plugin discovery verified through `plugin/list`

### Remote backend scaffolds
- Slack
- Discord
- Telegram

### Auto-learning path
- Codex Stop hook is re-enabled
- project-local learning artifacts are generated
- project-local skill auto-promotion now creates:
  - `.codex/skills/<rule>/SKILL.md`
  - `.omx/wiki/convention/<rule>.md`
  - `kb/wiki/convention/<rule>.md` when KB exists

---

## Important verified facts

1. Codex plugin wrapper is discoverable when bootstrap writes a valid `./plugins/codex-channels` source path.
2. Auto-learning is project-scoped because the script uses the git root / current cwd as the write root.
3. Claude already performs auto-learned skill generation and KB promotion; Codex now follows the same broad model, though with a simpler implementation.

---

## Important unfinished work

1. `hermit-agent` does **not yet** consume `codex-channels` as its Codex runtime.
2. The runtime exists, but Hermit integration still needs an adapter and install flow.
3. Remote reply/callback loops are still not complete.

---

## Immediate next session recommendation

Read these in order:
1. `docs/hermit-agent-codex-channels-prd.md`
2. `docs/hermit-agent-codex-channels-ralplan.md`
3. `docs/hermit-agent-codex-channels-implementation-spec.md`
4. this handoff file

Then start in the `hermit-agent` repository, not this one.

---

## Desired first PR in hermit-agent

- add a thin `codex-channels` adapter
- make `install-codex` configure codex-channels automatically
- implement one approval roundtrip and one free-text roundtrip
- add smoke tests

That should be the first concrete integration milestone.
