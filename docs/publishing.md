# Publishing

`codex-channels` is structured as an npm-first monorepo.

## Packages intended for publish

Publishing order matters because the CLI and backend packages depend on the shared workspace packages.

Recommended order:
1. `@cafitac/codex-channels-core`
2. `@cafitac/codex-channels-persistence-file`
3. `@cafitac/codex-channels-backend-local`
4. `@cafitac/codex-channels-backend-slack`
5. `@cafitac/codex-channels-backend-discord`
6. `@cafitac/codex-channels-backend-telegram`
7. `@cafitac/codex-channels-transport-codex-app-server`
8. `codex-channels`

## Local verification before publish

```bash
npm install
npm run check
npm run build
npm test
npm run pack:preview
```

## NPM access strategy

- `codex-channels` should publish as a public package.
- scoped workspace packages under `@cafitac/*` should publish with public access as well.

## Release strategy

- use semantic versioning
- tag releases as `vX.Y.Z`
- keep all workspace packages on the same version until there is a strong reason to split versioning

## GitHub Actions

The repository includes a release workflow scaffold that can publish packages on a version tag once `NPM_TOKEN` is configured.

## Notes

The plugin wrapper is not itself an npm package. The npm packages remain the canonical release artifacts; the plugin surface is a convenience layer for Codex installation and discovery.

## Final release prep

See [release-checklist.md](./release-checklist.md) before tagging or publishing.
