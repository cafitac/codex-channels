# PRD — Hermit-Agent × Codex-Channels Integration

## Status

Draft product requirements for the next implementation phase.

This document exists so a fresh session can resume work without reconstructing the intent from chat history.

---

## 1. Product statement

Enable `hermit-agent` to deliver a Claude-like human-in-the-loop UX when Codex is the primary agent by integrating `codex-channels` as the Codex-side interaction runtime.

In short:
- **Claude path**: Hermit uses Claude-native channels.
- **Codex path**: Hermit uses `codex-channels`.

The user should be able to configure Hermit for Codex and then experience:
- approval requests
- permission requests
- free-text questions
- structured user input
- progress / interruption hints

inside a Codex-friendly flow rather than through polling-heavy manual checks.

---

## 2. Problem

### Current good path
Claude Code already supports a native channel UX, so Hermit can request approval or ask questions and the user can respond naturally.

### Current bad path
When Codex is the main agent, Hermit interactions tend to degrade into:
- `check_task`
- `check_state`
- polling
- manual context switching

This is not a model quality problem; it is an integration and runtime UX problem.

### Root issue
Codex has lower-level app-server primitives for interactive flows, but Hermit does not yet consume a Codex-native channel/runtime layer in the same way it uses Claude-native channels.

---

## 3. Goal

When Hermit is configured for Codex, the installation/bootstrap flow should automatically set up `codex-channels`, and Hermit should route interaction events through it so that Codex users can respond without polling.

---

## 4. Non-goals

- Replacing Hermit's core task loop
- Replacing Claude-native channels when running under Claude
- Making Codex and Claude pixel-identical in UI
- Turning `codex-channels` into a generic hosted chat platform in this phase

---

## 5. Success criteria

### Functional
1. `hermit-agent` can be configured for Codex with one installation/bootstrap flow.
2. Hermit approval and permission requests are surfaced through `codex-channels`.
3. Hermit free-text questions and structured input requests are surfaced through `codex-channels`.
4. User responses flow back into Hermit and resume the task.
5. The local-first path works without Slack/Discord/Telegram.

### Product
6. `hermit-agent` no longer feels Claude-only.
7. Codex users can get a workflow closer to Claude's human-in-the-loop UX.
8. `codex-channels` remains a reusable Codex-first runtime rather than being absorbed into Hermit.

---

## 6. Architecture decision

### Chosen split

#### Hermit-Agent owns
- task lifecycle
- permission semantics
- ask-user semantics
- reply queue / resume behavior
- source-specific meaning of each interaction

#### Codex-Channels owns
- Codex-facing interaction runtime
- local/remote channel backends
- Codex app-server bridge
- user-facing delivery surface
- plugin/runtime setup for Codex

### Decision
`hermit-agent` should integrate with `codex-channels` as a dependency / runtime peer, not reimplement Codex channels internally.

---

## 7. User flows

### Flow A — approval request
1. User runs Codex as the main agent.
2. Hermit reaches a point where approval is needed.
3. Hermit emits an approval interaction via adapter.
4. `codex-channels` publishes it through the local runtime.
5. User approves/declines.
6. `codex-channels` returns the decision to Hermit.
7. Hermit resumes or aborts accordingly.

### Flow B — free-text question
1. Hermit calls `ask_user_question` equivalent.
2. Adapter turns it into a `user_input_request`.
3. `codex-channels` shows it.
4. User answers.
5. Response returns to Hermit.
6. Task continues.

### Flow C — structured elicitation
1. Hermit or Codex-side bridge needs structured response.
2. Adapter emits an `elicitation_request`.
3. `codex-channels` displays structured options.
4. User answers.
5. Hermit consumes structured reply.

---

## 8. Installation goal

The preferred UX is:

```bash
hermit-agent install-codex
```

or equivalent bootstrap flow.

That flow should:
1. verify Codex availability
2. verify `codex-channels` availability
3. install or configure `codex-channels` if needed
4. bootstrap the Codex plugin wrapper / local marketplace wiring
5. verify the local interaction runtime health
6. run a smoke check

---

## 9. Delivery scope

### MVP
- local-only path
- Hermit adapter
- approval request roundtrip
- free-text question roundtrip
- Codex install/bootstrap path
- end-to-end smoke test

### Post-MVP
- remote backend replies
- richer diagnostics
- stronger persistence
- user-facing workflow docs and examples

---

## 10. Risks

### Risk 1 — semantic mismatch
Hermit's waiting states may not map 1:1 to Codex interaction types.

**Mitigation:** canonical interaction types in adapter.

### Risk 2 — install complexity
Too many setup steps will reduce actual adoption.

**Mitigation:** make `install-codex` or bootstrap one command.

### Risk 3 — runtime drift
Codex app-server behavior may change over time.

**Mitigation:** keep Codex-specific complexity inside `codex-channels`.

### Risk 4 — local/remote split confusion
Users may assume Slack/Discord/Telegram are required.

**Mitigation:** keep local-first path the default and document remote channels as optional.

---

## 11. Product boundary

### What this phase should prove
- Hermit can use `codex-channels`
- Codex can receive and surface Hermit interaction requests
- User responses can resume Hermit tasks

### What this phase does not need to prove
- all remote backends fully operational
- hosted SaaS mode
- enterprise-grade auth or admin controls

---

## 12. Output of this PRD

If implemented correctly, a user should be able to say:

> Hermit-Agent is no longer Claude-only. In Codex, it uses codex-channels and the UX is close enough that I no longer need polling as my default control path.
