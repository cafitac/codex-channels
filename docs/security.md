# Security Notes

## Core assumptions

- Local-first is the default deployment mode.
- Remote channels are optional and explicitly enabled.
- Interaction payloads may contain sensitive context.

## Threats

1. **Channel token leakage**
2. **Sensitive payload exposure**
3. **Forged response callbacks**
4. **Replay of stale interaction ids**
5. **Protocol drift causing silent approval misrouting**

## Baseline requirements

- No secrets committed to the repository.
- Remote channel credentials must come from environment variables or external secret stores.
- Interaction logs should support redaction hooks.
- Backends should expose health state without dumping secrets or payloads.
- Correlation ids must be stable and auditable.

## Recommended future controls

- Signed callbacks for remote channels
- configurable payload redaction
- backend allowlist / denylist
- per-backend response timeout policy
- persistent audit trail with reason codes
