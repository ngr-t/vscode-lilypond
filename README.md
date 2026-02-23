# vscode-lilypond

A VS Code extension for LilyPond authoring with live SVG preview and bidirectional source/preview navigation.

## What You Can Do Now

- Edit LilyPond files with language support for `.ly`, `.ily`, `.lyi`
- Use snippets, completion, and hover docs for common LilyPond commands
- Get LilyPond diagnostics in Problems and jump to next/previous issues
- Open a live SVG preview rendered by the LilyPond CLI
- Click objects in preview to jump to source
- Move the source cursor to highlight matching objects in preview
- Control refresh behavior (`idleAndSave`, `saveOnly`, `manual`, `live`) with debounce/throttling settings
- Render only selected fragments in preview (`Render Selection In Preview`)
- Work with include-based projects using root-file selection and include diagnostics
- Export score outputs as PDF and MIDI
- Browse generated artifacts in the `LilyPond Artifacts` Explorer panel or `LilyPond: Open Latest Artifacts` quick picker
- Transpose selected music or whole documents
- Navigate musical structure via outline symbols and next/previous block commands
- Track render state from preview status + status bar (idle/updating/error)

## Requirements

- VS Code `^1.85.0`
- LilyPond installed and accessible from PATH, or set `lilypond.preview.lilypondPath`

## Quick Start

1. Install dependencies:
   - `npm install`
2. Compile extension:
   - `npm run compile`
3. Run extension in VS Code:
   - open this repository in VS Code
   - start `Run LilyPond Extension` launch config (`F5`)
4. In Extension Development Host:
   - open a LilyPond file (`*.ly`)
   - run `LilyPond: Open Preview`

## Commands

- `LilyPond: Open Preview`
- `LilyPond: Refresh Preview Now`
- `LilyPond: Render Selection In Preview`
- `LilyPond: Export PDF`
- `LilyPond: Export MIDI`
- `LilyPond: Open Latest Artifacts`
- `LilyPond: Refresh Artifacts`
- `LilyPond: Transpose`
- `LilyPond: Next Block`
- `LilyPond: Previous Block`
- `LilyPond: Toggle Auto Refresh`
- `LilyPond: Next Diagnostic`
- `LilyPond: Previous Diagnostic`
- `LilyPond: Set Root File`
- `LilyPond: Clear Root File`

## Settings

All settings are under `lilypond.preview.*`:

- `lilypondPath`
- `renderDelayMs`
- `refreshMode`
- `minRenderIntervalMs`
- `showUpdatingBadge`
- `cursorHighlightEnabled`
- `autoScrollToHighlight`
- `highlightHysteresisScore`

## Documentation

- Architecture: `docs/architecture.md`
- Development workflow: `docs/development.md`
- Troubleshooting: `docs/troubleshooting.md`
- Roadmap and backlog: `docs/roadmap.md`
- Snippets reference: `docs/snippets.md`
- Release workflow: `docs/release.md`
