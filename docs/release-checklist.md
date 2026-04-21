# Release Checklist

Use this checklist before publishing `codex-channels` packages or tagging a GitHub release.

## Repository readiness

- [ ] `npm install`
- [ ] `npm run preflight:release`
- [ ] `npm run check`
- [ ] `npm run build`
- [ ] `npm test`
- [ ] `npm run pack:preview`
- [ ] `npm run publish:dry-run`
- [ ] README and docs reflect the current CLI and backend surfaces
- [ ] CHANGELOG updated for the intended version

## Package readiness

- [ ] All workspace package versions are aligned
- [ ] `files` field excludes tests and source-only artifacts from npm tarballs
- [ ] LICENSE and package-level README files are present in every publishable workspace
- [ ] `publishConfig.access` is `public` where intended

## Release operations

- [ ] Git working tree is clean
- [ ] Git tag created as `vX.Y.Z`
- [ ] `NPM_TOKEN` configured for release automation or local publish
- [ ] Publish order reviewed (core dependencies first, CLI last)

## Post-release checks

- [ ] npm package pages resolve for all published workspaces
- [ ] GitHub release/tag visible on `cafitac/codex-channels`
- [ ] Installation docs still match the published package names and versions
