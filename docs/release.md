# Release Workflow

## Versioning

Use semantic versioning in `package.json`:

- patch: bug fixes
- minor: backward-compatible feature additions
- major: breaking changes

## Local Release Steps

1. Ensure working tree is clean.
2. Run quality checks:
   - `npm run compile`
   - `npm test`
3. Bump version in `package.json`.
4. Update `CHANGELOG.md`.
5. Create and push commit.
6. Tag release:
   - `git tag vX.Y.Z`
   - `git push origin vX.Y.Z`

## CI

- `.github/workflows/ci.yml`
  - runs on `main` pushes and pull requests
  - executes compile, tests, and package sanity check

## Tagged Release Packaging

- `.github/workflows/release.yml`
  - runs on tag push (`v*`)
  - builds extension and packages VSIX
  - uploads VSIX as workflow artifact

## Notes

- `package:ci` uses `npx @vscode/vsce` to avoid requiring global `vsce` install in CI.
- Publishing to Visual Studio Marketplace can be added later as a separate workflow step once publisher credentials are configured.
