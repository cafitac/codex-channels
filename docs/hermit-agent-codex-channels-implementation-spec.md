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

### Desired UX
```bash
hermit-agent install-codex
```

### Steps inside that flow
1. check Codex CLI/app-server presence
2. check `@cafitac/codex-channels`
3. bootstrap plugin wrapper / local marketplace
4. verify `.mcp.json` / plugin discovery
5. verify local runtime health
6. write a compact success report

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
- local plugin wrapper is discoverable
- local runtime starts

### runtime smoke
- approval request roundtrip
- free-text roundtrip

### diagnostics smoke
- missing runtime
- missing plugin bootstrap
- bridge unavailable

---

## 7. Suggested execution order

1. Create adapter contract module
2. Wire local-only interaction publish from Hermit
3. Wire response back into reply queue
4. Add install/bootstrap integration
5. Add smoke tests
6. Add docs

---

## 8. What to avoid
- reimplementing codex-channels logic inside Hermit
- requiring Slack/Telegram/Discord for MVP
- changing Hermit core semantics when adapter translation is enough
- trying to make Claude and Codex pixel-identical in the first pass
