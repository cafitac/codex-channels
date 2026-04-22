# Codex-Native Interaction Roadmap

## Intent

Move `codex-channels` from a CLI-assisted local runtime into a Codex-native interaction layer where approvals, user input, and replies can be handled from inside a Codex session instead of through a second shell.

This roadmap exists to keep the product direction stable across sessions now that the canonical-skill bootstrap fix has landed.

---

## Current state (after v0.1.12)

What is working today:
- `npm install -g @cafitac/codex-channels`
- `codex-channels plugin-bootstrap`
- canonical skill install into `~/.codex/skills/codex-channels` (or `.codex/skills/...` for workspace scope)
- Codex can see and route the `codex-channels` skill
- local runtime commands work (`doctor`, `demo`, `inspect`, `reply`)
- end-to-end local interaction creation is verified through `demo`

What is still missing:
- no Codex-session-native approval/input surface yet
- users still need shell commands for `demo`, `inspect`, and `reply`
- plugin marketplace artifacts remain secondary and are not the primary visibility path in current Codex CLI
- MCP-backed interaction requests are not yet surfaced back into the same Codex session without an external loop

Product interpretation:
- **Visibility problem**: solved by canonical skill installation
- **Interaction-host problem**: not solved yet

---

## Product goal

The long-term target is:

> A user can configure `codex-channels`, connect it to an MCP-backed workflow, and respond to approvals or questions from inside Codex without opening another shell.

This is a stronger goal than “plugin is visible” or “CLI works.”

---

## Design principles

1. **Codex-first** — Codex stays the primary agent surface.
2. **Local-first default** — local runtime remains the default path.
3. **Canonical skill root first** — Codex-visible skills under `~/.codex/skills` / `.codex/skills` are the primary user-facing integration path.
4. **Plugin wrappers are secondary** — plugin marketplace artifacts remain useful, but not as the only visibility mechanism.
5. **Progressive disclosure** — the normal path should not require users to understand plugin marketplace internals.
6. **Interaction-loop closure matters more than packaging purity** — if a bridge path works reliably in Codex sessions, prefer that over elegant-but-invisible plugin structures.

---

## Phase 1 — Short-term: reliable Codex-visible local runtime

### Goal
Make `codex-channels` feel like a first-class Codex skill for setup, diagnosis, and guided local runtime use.

### Scope
- keep user-scope bootstrap as the recommended default
- treat canonical skill installation as the primary install contract
- tighten docs around one happy path
- keep plugin wrapper generation for MCP/plugin experiments, but stop depending on it for basic visibility
- strengthen the skill content and command guidance for real use

### Concrete work
- keep `plugin-bootstrap` installing `~/.codex/skills/codex-channels/SKILL.md`
- consider adding dedicated skills:
  - `codex-channels-demo`
  - `codex-channels-doctor`
  - `codex-channels-reply`
- update quickstart to emphasize the canonical skill path first
- document that current Codex CLI visibility depends on the skill root, not just local marketplace files

### Exit criteria
- fresh machine: install + bootstrap + restart Codex leads to visible `codex-channels` skill
- users can run the local interaction loop with short docs and no marketplace knowledge
- install guidance recommends **user** scope by default unless a strong workspace-only case exists

---

## Phase 2 — Mid-term: Codex-driven orchestration of the local interaction loop

### Goal
Reduce or eliminate the need for the user to manually remember shell commands for the common local loop.

### Scope
- Codex skill drives the routine steps
- shell commands still exist underneath, but the user mostly interacts through Codex
- better runtime state introspection from inside the skill

### Concrete work
- make the `codex-channels` skill explicitly orchestrate:
  - runtime health checks
  - demo generation
  - interaction lookup
  - reply suggestions
- add guided reply UX in the skill:
  - list current interactions
  - select an interaction id
  - show options / free-text paths
- optionally add CLI helpers that produce Codex-friendly output:
  - `codex-channels list-pending`
  - `codex-channels resolve-latest`
  - `codex-channels demo --json`
- define a stable “operator flow” for Codex sessions:
  - bootstrap
  - health check
  - create interaction
  - inspect pending request
  - answer request

### Exit criteria
- a user can ask Codex to run the local verification flow without manually typing every shell command
- common flows no longer depend on a second shell for understanding what to do next
- `demo -> inspect -> reply` feels like one guided workflow rather than a list of unrelated commands

---

## Phase 3 — Long-term: Codex-native interaction host / bridge

### Goal
Handle interaction requests *inside the active Codex session* instead of routing humans through external shell commands.

### What success looks like
- an MCP-backed tool or runtime emits an approval request
- Codex surfaces that request in-session
- the user responds inside Codex
- `codex-channels` returns the structured response to the originating runtime
- no separate `inspect` / `reply` shell is required for the common path

### Required architecture shift
This phase is not a documentation or bootstrap problem. It requires `codex-channels` to become a true Codex-facing interaction bridge.

That likely means introducing or refining:
- a **source adapter layer** for incoming requests (MCP/app-server/external runtime)
- a **runtime core** that owns interaction persistence and correlation
- a **Codex session bridge** that can surface pending interactions back into the active Codex context
- a **response adapter** that maps Codex-side user actions back into source-runtime semantics

### Likely workstreams
#### A. Interaction contract
- define the normalized interaction kinds that `codex-channels` accepts
- define the response actions that can flow back out
- preserve correlation ids across the full loop

#### B. Session surfacing
- determine how Codex should render pending interactions in-session
- define whether this uses app-server primitives, MCP elicitation-compatible shapes, or a higher-level adapter surface
- verify which current Codex surfaces are actually stable enough to host this UX

#### C. Runtime lifecycle
- define how a waiting request is resumed, cancelled, retried, or expired
- make sure “reply from Codex” resolves the correct pending interaction

#### D. User experience
- approvals should feel native, not like a manual polling loop
- free-text and structured input should feel like in-session elicitation rather than shell-based state management

### Exit criteria
- a user can complete an approval or input request without leaving Codex
- no manual `inspect` / `reply` shell loop is needed for the default path
- at least one external runtime or MCP-backed workflow roundtrip is proven end-to-end

---

## Phase boundaries

### What Phase 1 does **not** solve
- in-session rendering of external requests
- eliminating the shell from the runtime loop
- external-runtime integration parity with Claude channels

### What Phase 2 does **not** solve
- true Codex-native interaction hosting
- removal of the underlying local runtime server
- seamless reply routing for arbitrary external runtimes

### What Phase 3 must solve
- interaction surfacing in-session
- response routing back to the origin runtime
- no-second-shell default UX

---

## Recommended next implementation order

1. **Finish Phase 1 cleanup**
   - simplify docs around user-scope bootstrap
   - decide whether `codex-channels` should stay one skill or split into sub-skills
2. **Start Phase 2 operator flow**
   - make the skill drive the local demo/inspect/reply loop more directly
3. **Write a dedicated Phase 3 design spec**
   - define the Codex session bridge contract before coding it

---

## Open questions

1. Which current Codex surface is the right host for in-session interaction rendering?
2. Is the long-term bridge best modeled as:
   - a Codex plugin/app-server bridge,
   - an MCP-facing adapter,
   - or a hybrid?
3. How much of the Claude-like UX can be reproduced with current Codex primitives versus requiring product-specific workarounds?
4. Should plugin wrapper generation remain in `plugin-bootstrap`, or be demoted to an advanced/optional path once the canonical skill path is stable?

---

## Current recommendation

Until Phase 3 exists, present `codex-channels` honestly as:
- **a Codex-visible local runtime skill**
- **not yet a fully in-session interaction host**

That keeps the product promise accurate while preserving the direction toward the stronger long-term UX.
