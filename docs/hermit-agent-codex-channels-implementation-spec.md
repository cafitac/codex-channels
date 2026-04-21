# Implementation Spec — Hermit-Agent × Codex-Channels

## Intent
This is the concrete build plan for the next session.

If you start a fresh session, read this file after the PRD and RALPLAN.

---

## 1. Files likely to change in hermit-agent

### Install / bootstrap
- `src/agent_learner/adapters/codex.py`
- `src/agent_learner/cli/main.py`
- `docs/install.md`

### Codex runtime / bridge path
- `hermit_agent/codex_runner.py`
- `hermit_agent/gateway/task_execution.py`
- `hermit_agent/gateway/task_runner.py`

### Waiting / permission / reply bridge
- `hermit_agent/gateway/permission.py`
- `hermit_agent/gateway/task_store.py`
- `hermit_agent/gateway/task_views.py`
- `hermit_agent/gateway/task_api.py`

### Tests
- `tests/test_codex_runner.py`
- new tests for adapter / roundtrip / install bootstrap

---

## 2. Adapter contract

### Hermit -> Codex-Channels interaction types
- `approval_request`
- `permissions_request`
- `user_input_request`
- `elicitation_request`
- `progress_update`
- `cancelled`
- `errored`

### Codex-Channels -> Hermit response types
- approve once
- approve for session
- deny
- cancel
- free-text response
- structured response

---

## 3. Minimal adapter module

Suggested new module shape:

```text
hermit_agent/codex_channels_adapter.py
```

Responsibilities:
- normalize Hermit events to `codex-channels` interaction schema
- normalize `codex-channels` responses to Hermit queue/reply semantics
- provide a tiny interface used from the gateway/runner path

Suggested entry points:
- `publish_interaction(...)`
- `await_response(...)`
- `handle_permission_request(...)`
- `handle_user_input_request(...)`

---

## 4. Install integration

Read together with:
- `docs/hermit-agent-codex-channels-install-ux-spec.md`

### Desired UX
```bash
hermit-agent install-codex
```

### Steps inside that flow
1. check Codex CLI/app-server presence
2. check `@cafitac/codex-channels`
3. verify the compiled CLI exists before bootstrap
4. bootstrap plugin wrapper / local marketplace with a workspace-local default
5. verify `.mcp.json` / plugin discovery
6. verify local runtime health
7. write a compact success report with exact next steps

---

## 5. MVP roundtrip to build first

### Approval flow
- Hermit emits approval request
- codex-channels local runtime publishes it
- user responds
- Hermit gets decision

### Free-text question flow
- Hermit emits user question
- codex-channels local runtime publishes it
- user answers
- Hermit resumes

These two flows are enough for the first integration proof.

---

## 6. Smoke tests to add

### install smoke
- bootstrap installs/configures codex-channels path
- build prerequisite is satisfied before bootstrap
- local plugin wrapper is discoverable
- local runtime starts

### runtime smoke
- approval request roundtrip
- free-text roundtrip

### diagnostics smoke
- missing runtime
- missing plugin bootstrap
- missing build artifact before bootstrap
- bridge unavailable

---

## 7. First PR checklist

### A. Adapter contract
- [ ] define the Hermit → codex-channels mapping for MVP interaction kinds
- [ ] define codex-channels → Hermit response mapping for MVP response actions
- [ ] preserve correlation fields required to resume the correct Hermit waiting task
- [ ] document lifecycle handling for resolved / cancelled / errored / cleared states

### B. Local roundtrip
- [ ] publish one approval request from Hermit through the adapter
- [ ] receive and apply the approval decision back into Hermit resume flow
- [ ] publish one free-text question through the adapter
- [ ] receive and apply the free-text reply back into Hermit resume flow

### C. Install-codex happy path
- [ ] make `hermit-agent install-codex` the single recommended entrypoint
- [ ] default to workspace-local bootstrap for MVP
- [ ] verify the compiled CLI before plugin bootstrap
- [ ] verify plugin / MCP discoverability after bootstrap
- [ ] run a compact smoke check before printing success
- [ ] print short next-step guidance after success

### D. Failure-mode guidance
- [ ] missing Codex guidance
- [ ] missing codex-channels guidance
- [ ] missing build artifact guidance
- [ ] missing bootstrap / marketplace guidance
- [ ] bridge unavailable guidance

### E. Docs
- [ ] add a compact install section to Hermit docs
- [ ] document the single happy path before advanced options
- [ ] keep remote channels clearly out of MVP docs

---

## 8. Suggested execution order

1. Create adapter contract module
2. Wire local-only interaction publish from Hermit
3. Wire response back into reply queue
4. Add install/bootstrap integration
5. Add smoke tests and failure-mode guidance
6. Add compact operator docs

---

## 9. What to avoid
- reimplementing codex-channels logic inside Hermit
- requiring Slack/Telegram/Discord for MVP
- changing Hermit core semantics when adapter translation is enough
- trying to make Claude and Codex pixel-identical in the first pass
