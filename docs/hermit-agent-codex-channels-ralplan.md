# RALPLAN — Hermit-Agent × Codex-Channels Integration

## Goal
Integrate `codex-channels` into `hermit-agent` so that Codex users can receive and answer Hermit interaction requests with a Claude-like human-in-the-loop workflow.

---

## Principles
1. **Codex-first on the Codex path** — Codex remains the primary agent.
2. **Claude baseline** — use Claude's current UX as the product baseline.
3. **Thin integration** — Hermit should not reimplement Codex channel runtime logic.
4. **Local-first default** — local runtime first, remote channels optional.
5. **Adapter isolation** — source-specific semantics stay in adapters.

---

## Decision drivers
1. Better Codex UX for Hermit interaction flows
2. Preserve `codex-channels` as an independent OSS runtime
3. Reduce polling/manual check workflows
4. Keep installation simple

---

## Viable options

### Option A — Hermit internal Codex channels implementation
- Pros: single repo
- Cons: duplicates runtime logic, weakens `codex-channels` as a product

### Option B — Hermit depends on codex-channels
- Pros: clean boundary, reusable runtime, easier long-term maintenance
- Cons: extra install/bootstrap work

### Chosen option
**Option B**

---

## ADR

### Decision
Hermit-Agent will use `codex-channels` as the Codex-side interaction runtime.

### Why chosen
This preserves the Codex-specific complexity in a dedicated layer while keeping Hermit's domain/task semantics intact.

### Alternatives considered
- Embed Codex runtime logic inside Hermit-Agent
- Continue with polling-centric Codex flow

### Consequences
- Need a Hermit adapter layer
- Need install/bootstrap automation
- Need end-to-end reply routing

### Follow-ups
- add adapter contract
- add install-codex bootstrap integration
- add local E2E smoke path
- add diagnostics

---

## Execution phases

### Phase 1 — contract
- define Hermit → codex-channels interaction mapping
- define codex-channels → Hermit response mapping

### Phase 2 — local roundtrip
- approval request roundtrip
- free-text question roundtrip

### Phase 3 — install flow
- `install-codex` / bootstrap integration
- codex-channels setup verification

### Phase 4 — diagnostics
- health check
- smoke test
- missing-config guidance

### Phase 5 — remote channels
- remote reply correlation
- backend-specific response handling

---

## Acceptance criteria
1. Hermit interaction request appears in Codex path via codex-channels.
2. User response returns to Hermit correctly.
3. Local path works with no Slack/Discord/Telegram required.
4. Installation can be described in one command or one compact flow.
5. At least one E2E local roundtrip is demonstrated.

---

## Risks and mitigations
- semantic mismatch -> adapter normalization
- install complexity -> bootstrap automation
- Codex drift -> codex-channels absorbs protocol changes
- remote backend complexity -> keep MVP local-only

---

## Recommended first implementation slice
1. adapter contract
2. local-only roundtrip
3. install-codex integration
4. smoke tests
