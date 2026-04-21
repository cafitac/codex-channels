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
6. **Minimal setup surface** — the default install/use path should feel closer to `oh-my-codex`: one obvious happy path, advanced knobs only when needed.
7. **Simplicity benchmark** — the product bar is closer to `npm install -g @openai/codex oh-my-codex` + `omx --madmax --high` than to a multi-page manual setup flow.

---

## Decision drivers
1. Better Codex UX for Hermit interaction flows
2. Preserve `codex-channels` as an independent OSS runtime
3. Reduce polling/manual check workflows
4. Keep installation simple
5. Minimize time-to-first-success after install

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
- Need explicit correlation preservation between Hermit waits and Codex-side interactions
- Need a default happy-path bootstrap that hides non-essential choices on first use

### Follow-ups
- add adapter contract
- add install-codex bootstrap integration
- add local E2E smoke path
- add diagnostics
- keep workspace-local bootstrap as the default MVP recommendation
- keep remote channels explicitly out of MVP unless local proof is already stable

### Additional ADR notes
- **Boundary ownership** — Hermit owns waiting/task semantics, approval meaning, and resume behavior; `codex-channels` owns transport/runtime/plugin wiring and delivery lifecycle.
- **Correlation preservation is mandatory** — the adapter must preserve enough request identity to resume the correct Hermit wait state.
- **Build-before-bootstrap is part of the product contract** — if the compiled CLI is missing, install flow should verify/build before plugin bootstrap rather than failing late.
- **Progressive disclosure** — workspace-local bootstrap is the default MVP path; user-level install and remote backends stay as secondary documentation paths.

---

## Execution phases

### Phase 0 — onboarding contract
- define the single recommended happy path for Codex users
- hide workspace-vs-user-scope choice behind defaults unless explicitly needed
- define the smoke path so users know what “working” means immediately after install

### Phase 1 — integration contract
- define Hermit → codex-channels interaction mapping using normalized interaction kinds
- define codex-channels → Hermit response mapping using explicit response actions
- preserve correlation fields needed to resolve the correct Hermit wait state
- define lifecycle handling for resolved / cancelled / errored / non-reply terminal paths

### Phase 2 — local roundtrip
- approval request roundtrip
- free-text question roundtrip
- response routing back into Hermit's resume/reply path

### Phase 3 — install/bootstrap
- `install-codex` / bootstrap integration
- verify Codex presence and `codex-channels` availability
- verify or build the compiled CLI before plugin/bootstrap wiring
- default to workspace-local bootstrap for MVP
- verify plugin / MCP discoverability after bootstrap

### Phase 4 — diagnostics + smoke proof
- install smoke
- local runtime smoke
- missing-runtime guidance
- missing bootstrap / marketplace guidance
- bridge unavailable guidance
- health check + compact success report

### Phase 5 — docs / operator guidance
- one compact install/use flow
- local-first explanation
- explicit “remote channels are optional” messaging

### Phase 6 — remote channels (post-MVP)
- remote reply correlation
- backend-specific response handling

---

## Acceptance criteria
1. Hermit interaction request appears in Codex path via codex-channels.
2. User response returns to Hermit correctly.
3. Local path works with no Slack/Discord/Telegram required.
4. Installation can be described in one command or one compact flow.
5. At least one E2E local roundtrip is demonstrated.
6. The MVP path preserves enough correlation data to resume the correct Hermit wait state.
7. Lifecycle completion works for user replies and non-reply terminal events.
8. Install flow verifies the compiled CLI before bootstrap and verifies plugin/MCP discoverability after bootstrap.
9. Default docs/CLI guidance presents one obvious happy path before exposing advanced scope choices.

---

## Risks and mitigations
- semantic mismatch -> adapter normalization
- install complexity -> bootstrap automation
- Codex drift -> codex-channels absorbs protocol changes
- remote backend complexity -> keep MVP local-only
- overexposed setup choices -> progressive disclosure with one default path and advanced flags/docs only when needed
- late bootstrap failure due to missing build artifacts -> build-before-bootstrap check in install flow

---

## Recommended first implementation slice
1. adapter contract
2. local-only approval + free-text roundtrip
3. install-codex integration with build/bootstrap/discoverability checks
4. smoke tests + failure-mode guidance
5. compact operator docs

## First PR scope

### Include
- thin Hermit ↔ codex-channels adapter contract
- approval request roundtrip
- free-text question roundtrip
- permissions request only if the first real Hermit path already needs it
- install-codex automation with default workspace-local bootstrap
- smoke path that is obvious enough to function like a mini `doctor`
- failure-mode guidance for runtime missing / bootstrap missing / bridge unavailable

### Exclude
- remote backends and callback loops
- Slack / Discord / Telegram-specific logic
- broad structured elicitation coverage beyond what the first proof needs
- Hermit core semantic redesign
- pixel-parity work against Claude UI
- multi-user / hosted / admin platform scope
