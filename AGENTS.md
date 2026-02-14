# Repository Guidelines

This repository contains a VS Code extension scaffold for LilyPond language support and a preview command.

## Project Structure & Module Organization

- Source code: `src/` (extension entrypoint and preview pipeline in `src/extension.ts`).
- Compiled output: `dist/` (generated JS used by VS Code via `main` in `package.json`).
- Syntax + language config: `syntaxes/` and `language-configuration.json`.
- Editor/debug config: `.vscode/` (launch config for Extension Development Host).

## Build, Test, and Development Commands

- `npm run compile`: compile TypeScript (`src/`) into `dist/`.
- `npm run watch`: compile in watch mode while developing.
- `npm run lint`: lint TypeScript sources with ESLint.
- `npm run package`: package the extension with `vsce package` (requires `vsce` availability).
- Run in VS Code: use the `Run LilyPond Extension` launch config (F5) to start an Extension Development Host.
- Preview commands: `LilyPond: Open Preview`, `LilyPond: Refresh Preview Now`, `LilyPond: Toggle Auto Refresh`.
- Preview settings: configure under `lilypond.preview.*` (binary path, refresh mode, debounce, and throttling).

## Coding Style & Naming Conventions

- Language: TypeScript.
- Indentation: 2 spaces.
- Naming: lowerCamelCase for variables/functions; PascalCase for types/classes.
- Linting: ESLint (`npm run lint`). Keep code warning-free before commit.

## Testing Guidelines

No automated tests are configured yet.

- If tests are added, prefer `test/` or `src/__tests__/` and document exact commands in `package.json`.
- Add test naming conventions (`*.test.ts`) when framework is introduced.

## Commit & Pull Request Guidelines

- Commit messages: use concise, imperative summaries (example: "Add LilyPond preview renderer").
- Pull requests: include a short description, linked issue (if any), and screenshots or GIFs for UI changes.

## Agent-Specific Instructions

- Keep this document updated as soon as source code, scripts, or tooling are added.
- Prefer documenting exact commands over general statements once tooling exists.
