# LilyPond VS Code Extension - Spec v0

## Goal

Provide a VS Code extension that improves LilyPond authoring with live preview, source-to-preview navigation, syntax support, linting, completion, and transposition workflows.

## Feasibility Snapshot

All requested features are possible in principle within VS Code’s extension model:

- Live preview: render LilyPond to SVG/PNG/PDF and display in a Webview with refresh.
- Source-to-preview highlight: requires mapping LilyPond source positions to rendered output positions; LilyPond can emit debugging info with `--point-and-click` and `-dbackend=eps`/`svg` pipelines.
- Syntax highlighting/linting/completion: use TextMate grammar + Language Server (custom or reused).
- Transposition: can be implemented as a command that rewrites selected regions or a full document transform.

## Toolchain Investigation (Initial)

### Core Rendering

- **LilyPond CLI**: canonical renderer. Use a user-configured `lilypond` binary path.
- **Output format**: prefer SVG for navigation/highlighting; raster fallback for performance.
- **Point-and-click**: enable with `-dpoint-and-click` to embed source references in SVG output (links with `textedit://` style targets).

#### Concrete Render Pipeline (Proposed)

- Base command (SVG):
  - `lilypond -dbackend=svg -dno-print-pages -dpoint-and-click -o <outDir>/<base> <file>.ly`
- Multipage handling:
  - LilyPond outputs one SVG per page, typically `<base>-page1.svg`, `<base>-page2.svg`, etc.
- Diagnostics capture:
  - Capture stderr for warnings/errors; parse into VS Code diagnostics.
- Working directory:
  - Run from the source file directory so relative includes work.
- Caching:
  - Output to `.vscode/lilypond-preview/` with a stable base name (e.g., file hash).

#### Mapping Source to SVG (Proposed)

- LilyPond SVG output includes `a xlink:href="textedit://...:line:column"` anchors for point-and-click.
- Parse anchors and build a map of source range to SVG element ids.
- Cursor change -> find nearest source key -> highlight matching SVG elements.
- Preview click -> extract `textedit://` target -> reveal in editor.

### Preview UI

- **VS Code Webview**: render SVG pages with pan/zoom.
- **File watcher**: watch `.ly` file and rerun render with debounce.
- **Cache**: store outputs in workspace `.vscode/lilypond-preview/`.

### Language Features

- **Syntax highlighting**: TextMate grammar (`syntaxes/lilypond.tmLanguage.json`).
- **Linting**: parse LilyPond CLI stderr and map diagnostics to document ranges.
- **Completion**: start with a curated completion list; later expand via language server.

### Transposition

- **Command**: `LilyPond: Transpose` with input key (e.g., `c -> d`).
- **Transform**: parse tokens or use a lightweight LilyPond parser to avoid damaging markup.

### External References

- Frescobaldi feature set suggests achievable parity.
- Investigate if Frescobaldi exposes reusable parsing or mapping logic (license and integration permitting).

## Proposed Architecture

- **Extension host (Node.js / TypeScript)**:
  - File watcher + render orchestration.
  - Diagnostics provider.
  - Commands: preview toggle, transpose, reveal in preview.
- **Webview**:
  - Renders SVG pages.
  - Highlights elements with source refs.
  - Emits click events to reveal in editor.
- **Language support**:
  - TextMate grammar for syntax.
  - Optional LSP server for advanced completion/analysis.

## Feature Requirements (MVP)

1. **Preview**
   - Render current file on save or idle.
   - Show page thumbnails + main view.
   - Configurable LilyPond binary path.
2. **Source-to-Preview Highlight**
   - When cursor moves, highlight corresponding SVG element(s).
   - Requires point-and-click metadata in output.
3. **Syntax + Lint**
   - Basic syntax highlighting.
   - Parse LilyPond warnings/errors into VS Code diagnostics.
4. **Transposition**
   - Command to transpose selected region or full file.
   - Safe defaults and undo support.

## Open Questions / Risks

- Mapping granularity of LilyPond `point-and-click` metadata to accurate editor ranges.
- Performance for large scores; need incremental rendering or page caching.
- Parser strategy for transposition without corrupting non-musical markup.
- Licensing/compatibility if borrowing logic from Frescobaldi.

## Next Steps

1. Validate LilyPond CLI flags for point-and-click and SVG mapping.
2. Prototype minimal render + webview display.
3. Implement diagnostics from stderr.
4. Draft initial TextMate grammar.
