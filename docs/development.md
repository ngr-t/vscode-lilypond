# Development

## Prerequisites

- Node.js + npm
- LilyPond CLI installed locally
- VS Code

## Setup

1. Install dependencies:
   - `npm install`
2. Build:
   - `npm run compile`

## Local Run

1. Open repository in VS Code.
2. Start launch config `Run LilyPond Extension` (`F5`).
3. In Extension Development Host, open a `.ly` file.
4. Run `LilyPond: Open Preview`.

## Useful Commands

- Build once: `npm run compile`
- Build watch: `npm run watch`
- Tests: `npm test`
- Package sanity check: `npm run package:ci`
- Lint (requires ESLint config): `npm run lint`

## Tests

- Current regression tests live in `test/`.
- `npm test` compiles TypeScript then runs Node test runner against `test/**/*.test.js`.
- Existing tests focus on `textedit://` parse/rewrite logic to prevent navigation regressions.
- Matching and diagnostics parsers are also regression-tested.

## Logging

Use `View -> Output` and select channel `LilyPond Preview`.

Key log events include:

- command invocation
- render start/success/error
- webview messages
- cursor sync events

## Release

- See `docs/release.md` for versioning, tagging, and CI release packaging steps.
