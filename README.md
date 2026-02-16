# vscode-lilypond

A VS Code extension for LilyPond authoring with live SVG preview and bidirectional source/preview navigation.

## Features

- LilyPond language registration for `.ly`, `.ily`, `.lyi`
- LilyPond preview panel rendered from the LilyPond CLI
- Click in preview to jump to source location
- Move cursor in source to highlight corresponding preview object
- Configurable preview refresh behavior (`idleAndSave`, `saveOnly`, `manual`, `live`)
- Curated command completion for common `\\` LilyPond keywords
- Hover docs for core LilyPond commands
- Quick fixes for selected LilyPond diagnostics (missing version, escaped-string typo, unclosed block hint)
- Root-file workflow for include-based projects (`Set Root File` / `Clear Root File`)
- Partial render command for selected LilyPond fragments
- Dedicated Explorer artifacts panel (`LilyPond Artifacts`) for PDF/MIDI/SVG outputs
- Transpose command for selection or whole document
- Outline symbols and next/previous block navigation

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
