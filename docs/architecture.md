# Architecture

## Runtime Model

The extension has two execution contexts:

- Extension host (Node.js, TypeScript): command handling, render orchestration, process management
- Webview (browser context): preview UI rendering and interaction handling

## Module Layout

- `src/extension.ts`
  - Entry point (`activate`, `deactivate`)
  - Bootstraps logger and preview controller
- `src/preview/PreviewController.ts`
  - Command registration
  - Auto-refresh scheduling/debounce/throttle
  - Webview lifecycle and message bridge
  - Cursor-to-preview and preview-to-editor flow
- `src/render/LilypondRenderer.ts`
  - LilyPond process spawn/cancellation hooks
  - Preview cache management
  - SVG loading/sanitization and HTML assembly
- `src/sync/textEdit.ts`
  - `textedit://` parsing
  - SVG target rewrite from cache input path to source path
- `src/webview/template.ts`
  - Webview HTML/CSS/JS template
  - Anchor binding, cursor highlight, and click event posting
- `src/config/settings.ts`
  - Typed accessors for `lilypond.preview.*` settings
- `src/log/logger.ts`
  - Output channel logging (`LilyPond Preview`)

## Data Flow

1. User opens preview command.
2. Controller requests render from renderer.
3. Renderer writes temp input, executes LilyPond, reads SVG, rewrites point-and-click links.
4. Controller posts rendered page HTML to webview (`update` message).
5. Webview binds point-and-click anchors and displays SVG pages.
6. Cursor movement posts `cursor` message to webview, which highlights nearest anchor.
7. Preview click posts `previewClick` to controller, which reveals source in editor.

## Cancellation and Refresh

- Typing renders are debounced and throttled.
- In-flight LilyPond processes are cancelled when superseded by newer render requests.
- Stale render results are discarded using token checks.
