# Install UX Spec — Hermit-Agent × Codex-Channels

## Intent
Define the **default user experience** for enabling the Codex path in `hermit-agent`.

This exists to protect the product goal that the Codex install/use flow should feel closer to `oh-my-codex`:
- one obvious happy path
- minimal required decisions
- a fast proof that the install actually works

---

## Product stance

### Simplicity benchmark
For now, the benchmark is the feeling of the `oh-my-codex` path:

```bash
npm install -g @openai/codex oh-my-codex
omx --madmax --high
```

`codex-channels` does not need to copy that packaging literally, but the **user-perceived setup burden** for the default path should be in the same league:
- very short install story
- one obvious next command
- fast confirmation that the path is actually usable

### Desired feel
The first-time user should experience this as:

```bash
hermit-agent install-codex
```

Then a short success/smoke path, not a long setup tutorial.

### Design rule
The MVP path should optimize for:
1. **time-to-first-success**
2. **minimal cognitive load**
3. **safe defaults**
4. **advanced choices only when needed**

---

## Default happy path

### One-command primary entry
```bash
hermit-agent install-codex
```

### What that command should do by default
1. verify Codex is installed and callable
2. verify `codex-channels` is available
3. verify the compiled CLI exists, or build/bootstrap it if the chosen distribution model allows
4. bootstrap the plugin wrapper with a **workspace-local default**
5. verify plugin / MCP discoverability
6. run a compact local smoke check
7. print a short success summary with the exact next command to use

### Default next-step output
Successful output should end with something like:

```text
Codex path is ready.

Verified:
- codex-channels CLI available
- plugin bootstrap installed
- MCP/plugin discovery working
- local runtime smoke passed

Next:
1. restart Codex if it is already open
2. run your normal Hermit Codex workflow
```

The default output should be short enough that a user can scan it in one screen.

---

## Progressive disclosure

### What should NOT be asked on the happy path
Do **not** require the user to choose these during the normal first install:
- workspace vs user scope
- local vs remote channels
- Slack / Discord / Telegram
- advanced marketplace file locations
- custom plugin path wiring

### What should happen instead
- default to **workspace-local**
- keep **local runtime** as the only MVP backend
- surface advanced paths as:
  - optional flags
  - follow-up docs
  - recovery guidance only when the default path does not fit

### Advanced options
Advanced install shapes can exist, but should be explicit opt-ins such as:

```bash
hermit-agent install-codex --scope user
hermit-agent install-codex --plugin-path /custom/path
```

The normal docs should not lead with those options.

---

## Smoke path

## What “working” means
The install is only successful if all of these are true:
1. Codex is available
2. `codex-channels` CLI is runnable
3. plugin/bootstrap wiring is present
4. Codex can discover the plugin/MCP shape
5. the local interaction runtime can start
6. at least one compact roundtrip proof or equivalent health check passes

### MVP smoke contract
The smoke path should check:
- build prerequisite satisfied
- bootstrap path written
- discoverability verified
- local runtime reachable
- a compact Hermit-facing or runtime-facing proof succeeds

### UX rule
Do not end the install flow with “setup complete” if the smoke path has not actually passed.

---

## Failure handling

The command should fail with **specific recovery guidance**, not generic error text.

### Failure mode: Codex missing
Output should say:
- Codex is required
- the exact install step to fix it
- rerun `hermit-agent install-codex`

### Failure mode: codex-channels missing
Output should say:
- `codex-channels` is required for the Codex path
- whether Hermit can install/configure it automatically or the exact manual fallback

### Failure mode: compiled CLI missing
Output should say:
- plugin bootstrap depends on the compiled CLI
- whether Hermit built it automatically or exactly how to build it

### Failure mode: bootstrap/discoverability missing
Output should say:
- what path was expected
- whether restart is required
- the shortest rerun/recovery command

### Failure mode: runtime smoke failed
Output should say:
- which boundary failed
- whether this is install, bridge, or runtime health
- the next single best recovery step

---

## First PR UX target

The first `hermit-agent` PR does **not** need to solve every install shape.

It **does** need to prove:
1. the default Codex install path is short
2. the default path is local-first
3. the default path verifies success instead of assuming it
4. advanced setup choices are deferred
5. the setup burden is moving toward the `oh-my-codex` simplicity benchmark

### Explicitly acceptable MVP simplifications
- workspace-local default only in the first success path
- user-scope documented but not optimized first
- local smoke only
- remote channels excluded

---

## CLI contract draft

### Primary command
```bash
hermit-agent install-codex
```

### Optional follow-up command
If a separate health command is useful, keep it short and obvious:

```bash
hermit-agent doctor codex
```

But if possible, `install-codex` should already run enough verification that a second command is optional, not required.

---

## Documentation contract

The first docs a new user sees should be:
1. one install command
2. one short explanation of what it sets up
3. one short “how to know it worked” section
4. one short “advanced paths” section

Do not front-load the reader with plugin internals, marketplace file layout, or remote backend scaffolding.
