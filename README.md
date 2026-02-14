# vscode-lilypond

A VS Code extension for LilyPond authoring with live SVG preview and bidirectional source/preview navigation.

## Features

- LilyPond language registration for `.ly`, `.ily`, `.lyi`
- LilyPond preview panel rendered from the LilyPond CLI
- Click in preview to jump to source location
- Move cursor in source to highlight corresponding preview object
- Configurable preview refresh behavior (`idleAndSave`, `saveOnly`, `manual`, `live`)

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
- `LilyPond: Toggle Auto Refresh`

## Settings

All settings are under `lilypond.preview.*`:

- `lilypondPath`
- `renderDelayMs`
- `refreshMode`
- `minRenderIntervalMs`
- `showUpdatingBadge`
- `cursorHighlightEnabled`
- `autoScrollToHighlight`

## Documentation

- Architecture: `docs/architecture.md`
- Development workflow: `docs/development.md`
- Troubleshooting: `docs/troubleshooting.md`
- Roadmap and backlog: `docs/roadmap.md`
