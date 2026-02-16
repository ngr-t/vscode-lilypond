# Product Roadmap And Backlog

This roadmap uses Frescobaldi as a reference model, but focuses on a smaller and maintainable VS Code-native scope.

## Milestone 1: Reliable Daily Editing Loop

Goal: make edit->render->fix cycle stable and fast enough for daily usage.

### M1-1 Improve LilyPond Diagnostics Mapping
- Size: M
- Priority: P0
- Description: Parse LilyPond stderr into structured diagnostics with severity, message, and source location.
- Acceptance criteria:
  - Errors/warnings appear in VS Code Problems view.
  - Clicking a diagnostic jumps to the correct source line.
  - Diagnostics clear correctly after successful render.

### M1-2 Diagnostic Navigation Command
- Size: S
- Priority: P1
- Description: Add commands to jump to next/previous LilyPond diagnostic.
- Acceptance criteria:
  - Commands exist and are discoverable in command palette.
  - Navigation order matches file order.
  - If no diagnostics exist, command shows a non-blocking info message.

### M1-3 Render Status Bar Item
- Size: S
- Priority: P1
- Description: Show current preview/render state and elapsed time in status bar.
- Acceptance criteria:
  - Status bar shows `Idle`, `Rendering`, `Error` states.
  - Last render duration displayed after successful render.
  - Clicking status bar item opens preview.

### M1-4 Preview Sync Reliability Improvements
- Size: M
- Priority: P1
- Description: Tighten cursor-to-preview matching around dense notation cases.
- Acceptance criteria:
  - Cursor highlighting remains stable when multiple anchors share same line.
  - No highlight oscillation during arrow-key navigation.
  - Add regression tests for matching edge cases.

## Milestone 2: Authoring Productivity Foundation

Goal: reduce typing friction and surface common LilyPond knowledge inside editor.

### M2-1 Core Snippet Pack
- Size: M
- Priority: P0
- Description: Provide snippets for common score constructs (staff, voice, relative, chord mode, lyrics, header/layout/midi).
- Acceptance criteria:
  - Snippets appear only for LilyPond files.
  - Tab stops are practical for real score authoring.
  - Documentation includes snippet trigger list.

### M2-2 Basic Completion Provider
- Size: M
- Priority: P0
- Description: Add completion provider for frequently used commands and keywords.
- Acceptance criteria:
  - Completion triggers on backslash command patterns.
  - Items include brief detail text.
  - Completion latency remains low (<100ms for local lookup).

### M2-3 Hover Docs For Core Commands
- Size: M
- Priority: P1
- Description: Add hover content for high-frequency LilyPond commands.
- Acceptance criteria:
  - Hover shows concise explanation and basic syntax.
  - Works for at least initial curated command set.
  - Unknown tokens do not show noisy fallback hovers.

### M2-4 Quick Fixes For Frequent Errors
- Size: L
- Priority: P1
- Description: Add code actions for common diagnostics (missing braces, missing version, common typo patterns).
- Acceptance criteria:
  - At least 3 actionable quick-fix categories implemented.
  - Fixes are previewable and undo-safe.
  - Code actions only appear when relevant.

## Milestone 3: Multi-File Score Workflow

Goal: support real projects with includes and larger score structures.

### M3-1 Include Graph Resolver
- Size: L
- Priority: P0
- Description: Resolve `\\include` dependencies from active root score and detect missing/recursive includes.
- Acceptance criteria:
  - Include tree is built for current root document.
  - Missing includes produce clear diagnostics.
  - Recursive include loops are detected and reported.

### M3-2 Root-File Selection
- Size: M
- Priority: P0
- Description: Let users choose and persist a root score file for rendering.
- Acceptance criteria:
  - Command to set root file exists.
  - Root selection persists per workspace.
  - Preview and diagnostics use root context.

### M3-3 Partial Render Support
- Size: L
- Priority: P1
- Description: Introduce section/selection-based render mode for faster iteration.
- Acceptance criteria:
  - User can trigger partial render intentionally.
  - Clear UI indicates partial vs full render.
  - Fallback to full render on unsupported selections.

### M3-4 File Watch Integration For Includes
- Size: M
- Priority: P1
- Description: Refresh preview when included files change.
- Acceptance criteria:
  - Edits in included files trigger root re-render.
  - Debounce/throttle behavior remains consistent.
  - Watchers are cleaned up when root changes.

## Milestone 4: Output And Playback

Goal: support export workflows beyond in-editor SVG preview.

### M4-1 PDF Export Command
- Size: M
- Priority: P1
- Description: Add command to compile and open PDF output.
- Acceptance criteria:
  - Command creates PDF successfully for valid score.
  - Output location configurable.
  - Errors surfaced through diagnostics/logs.

### M4-2 MIDI Export And Play Command
- Size: M
- Priority: P2
- Description: Add command to compile MIDI and open/play output.
- Acceptance criteria:
  - MIDI file generated when score includes MIDI block.
  - Command handles missing MIDI block gracefully.
  - User receives clear success/failure notification.

### M4-3 Output Artifacts Panel
- Size: M
- Priority: P2
- Description: List latest generated artifacts (SVG/PDF/MIDI) with open actions.
- Acceptance criteria:
  - Panel reflects latest successful build artifacts.
  - Open actions work across supported platforms.
  - Artifacts panel updates after each render/export.

## Milestone 5: Advanced Editing Tools

Goal: approach selected Frescobaldi-like power features.

### M5-1 Transposition Command (Selection/Document)
- Size: L
- Priority: P1
- Description: Implement transpose command with source/target key input.
- Acceptance criteria:
  - Works for selection and whole document.
  - Undo returns exact previous text.
  - Non-music text regions are preserved.

### M5-2 Structure Outline Provider
- Size: M
- Priority: P2
- Description: Provide symbols/outline for major score blocks.
- Acceptance criteria:
  - Outline shows key sections and contexts.
  - Clicking outline nodes jumps to source.
  - Outline updates on document change.

### M5-3 Navigation Commands By Musical Blocks
- Size: M
- Priority: P2
- Description: Add jump commands for next/previous section, voice, or block.
- Acceptance criteria:
  - Commands are keyboard-bindable.
  - Navigation is deterministic and test-covered.
  - Handles nested blocks without crashes.

## Quality Track (Runs Alongside All Milestones)

### Q-1 Unit Test Expansion
- Size: M per milestone
- Priority: P0
- Description: Add unit tests for parsers/mappers/schedulers for each new subsystem.
- Acceptance criteria:
  - New critical logic has targeted tests.
  - Regression tests added for each fixed bug.

### Q-2 Integration Smoke Tests
- Size: L
- Priority: P1
- Description: Add extension-level smoke tests for key commands and preview lifecycle.
- Acceptance criteria:
  - Open preview, render, click navigation, cursor highlight flows are covered.
  - CI executes smoke tests on pull requests.

### Q-3 Release Workflow
- Size: M
- Priority: P1
- Description: Establish release process (versioning, changelog, packaging).
- Acceptance criteria:
  - Version bump process documented.
  - Automated changelog update path exists.
  - VSIX package generation is reproducible.

## Suggested Delivery Order

1. M1-1 -> M1-4
2. M2-1 -> M2-4
3. M3-1 -> M3-4
4. M4-1 -> M4-3
5. M5-1 -> M5-3

## Definition Of Done (For Any Backlog Item)

- Behavior implemented and manually verified.
- Tests added or updated.
- User-facing settings/commands documented.
- No regressions in preview open, render, click navigation, cursor highlight.

## Implementation Audit

Last audited: 2026-02-16

### Status Legend

- `done`: implemented and validated against acceptance criteria
- `partial`: implemented but one or more acceptance criteria need follow-up
- `deferred`: not implemented yet

### Milestone Status

| Item | Status | Notes |
|---|---|---|
| M1-1 Improve LilyPond Diagnostics Mapping | done | Problems integration with parsed stderr diagnostics is in place. |
| M1-2 Diagnostic Navigation Command | done | Next/previous diagnostic commands implemented. |
| M1-3 Render Status Bar Item | done | Idle/rendering/error status bar states and timing tooltip implemented. |
| M1-4 Preview Sync Reliability Improvements | done | Matching hysteresis + regression tests added. |
| M2-1 Core Snippet Pack | done | Snippet pack + trigger docs (`docs/snippets.md`) added. |
| M2-2 Basic Completion Provider | done | Curated command completion provider implemented. |
| M2-3 Hover Docs For Core Commands | done | Hover docs for curated LilyPond commands implemented. |
| M2-4 Quick Fixes For Frequent Errors | done | 3+ quick-fix categories implemented. |
| M3-1 Include Graph Resolver | done | Include graph parsing with missing/cycle diagnostics implemented. |
| M3-2 Root-File Selection | done | Set/clear root file commands with persisted workspace state implemented. |
| M3-3 Partial Render Support | done | Selection-based partial render command with explicit status label implemented. |
| M3-4 File Watch Integration For Includes | done | Include-related file watcher triggers root rerender; watcher lifecycle managed. |
| M4-1 PDF Export Command | done | PDF export + open flow implemented. |
| M4-2 MIDI Export And Play Command | done | MIDI export + open flow implemented with failure guidance. |
| M4-3 Output Artifacts Panel | done | Dedicated Explorer tree view (`lilypondArtifacts`) added with refresh + click-to-open; quick-pick command retained. |
| M5-1 Transposition Command (Selection/Document) | partial | Selection/document transpose implemented; non-musical region preservation is heuristic and should be hardened. |
| M5-2 Structure Outline Provider | done | Document symbol provider for key blocks/assignments implemented. |
| M5-3 Navigation Commands By Musical Blocks | done | Next/previous block navigation commands implemented with parsing tests. |
| Q-1 Unit Test Expansion | done | Regression suite expanded to matching, diagnostics, include graph, structure, transposition helpers. |
| Q-2 Integration Smoke Tests | done | Extension-host smoke harness (`test/smoke`) now validates preview open/render, click navigation, cursor sync, and refresh flows; CI runs it on PRs/pushes. |
| Q-3 Release Workflow | done | CI/release workflows, changelog, and release docs are in place, with packaging sanity checks integrated in CI. |

### Follow-Up Priorities

1. Upgrade `M5-1` transposition with parser-aware transforms to preserve non-musical regions robustly.
