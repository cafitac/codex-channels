# Security Policy

## Supported scope

`codex-channels` is early-stage software. Security fixes should prioritize the current default branch and the latest published packages once publishing begins.

## Reporting a vulnerability

Please do **not** open a public issue for a sensitive vulnerability.

Until a dedicated security contact is added, report vulnerabilities privately through GitHub security advisories for the repository if available.

Include:
- affected package(s)
- affected version or commit
- reproduction steps
- impact assessment
- suggested fix if known

## Areas most likely to need review

- local HTTP runtime exposure
- remote backend token handling
- persistence of interaction payloads
- plugin bootstrap and marketplace wiring
- bridge request/response correlation
