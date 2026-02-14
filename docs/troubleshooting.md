# Troubleshooting

## Preview opens but stays empty

- Ensure extension host is running latest code:
  - stop debug session
  - rerun `Run LilyPond Extension` (`F5`)
- Check output logs:
  - `View -> Output`
  - select `LilyPond Preview`

## LilyPond binary not found

- Install LilyPond or set:
  - `lilypond.preview.lilypondPath`

## Click preview does not jump to source

- Confirm logs show:
  - `Webview message: previewClick`
- If navigation fails, check target path in logs and confirm file exists locally.

## Cursor highlight does not appear

- Ensure setting is enabled:
  - `lilypond.preview.cursorHighlightEnabled = true`
- Check logs for:
  - `Cursor: ...`
  - `Webview: cursor-match ...` or `cursor-no-match ...`

## Refresh feels too frequent or too slow

Tune:

- `lilypond.preview.refreshMode`
- `lilypond.preview.renderDelayMs`
- `lilypond.preview.minRenderIntervalMs`

Recommended default balance:

- `refreshMode = idleAndSave`
- `renderDelayMs ~ 500-800`
- `minRenderIntervalMs ~ 1000-1500`
