const assert = require('node:assert/strict');
const path = require('path');
const vscode = require('vscode');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSelection(editor, line, character, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const active = editor.selection.active;
    if (active.line === line && active.character === character) {
      return;
    }
    await sleep(50);
  }
  throw new Error(`Timed out waiting for selection ${line}:${character}`);
}

async function run() {
  const extension = vscode.extensions.all.find((item) => item.packageJSON.name === 'vscode-lilypond');
  assert.ok(extension, 'Extension not found in test host');

  const api = await extension.activate();
  assert.equal(typeof api.getPreviewDebugState, 'function');
  assert.equal(typeof api.waitForPreview, 'function');
  assert.equal(typeof api.simulatePreviewClick, 'function');

  assert.ok(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0, 'Workspace is required');
  const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const docPath = path.join(workspaceRoot, 'main.ly');
  const fakeBinaryPath = path.join(extension.extensionPath, 'test', 'smoke', 'fixtures', 'fake-lilypond.js');

  const config = vscode.workspace.getConfiguration('lilypond.preview');
  await config.update('lilypondPath', fakeBinaryPath, vscode.ConfigurationTarget.Workspace);
  await config.update('refreshMode', 'manual', vscode.ConfigurationTarget.Workspace);
  await config.update('cursorHighlightEnabled', true, vscode.ConfigurationTarget.Workspace);

  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(docPath));
  const editor = await vscode.window.showTextDocument(document);

  await vscode.commands.executeCommand('lilypond.preview');
  const renderedState = await api.waitForPreview((state) => state.status === 'idle' && state.pagesCount > 0, 20000);
  assert.equal(renderedState.pagesCount, 1);

  const anchorState = await api.waitForPreview(
    (state) => typeof state.lastPreviewDebugMessage === 'string' && state.lastPreviewDebugMessage.includes('anchorCount='),
    10000
  );
  assert.match(anchorState.lastPreviewDebugMessage, /anchorCount=\d+/);

  editor.selection = new vscode.Selection(new vscode.Position(2, 2), new vscode.Position(2, 2));
  const cursorState = await api.waitForPreview(
    (state) => Boolean(state.lastCursor && state.lastCursor.line === 3 && state.lastCursor.column === 3),
    5000
  );
  assert.equal(cursorState.lastCursor.line, 3);
  assert.equal(cursorState.lastCursor.column, 3);

  const href = `textedit://${encodeURIComponent(docPath)}:3:1:4`;
  await api.simulatePreviewClick(href);
  await waitForSelection(editor, 2, 0);

  await vscode.commands.executeCommand('lilypond.preview.refreshNow');
  const refreshState = await api.waitForPreview((state) => state.status === 'idle' && state.pagesCount > 0, 20000);
  assert.equal(refreshState.pagesCount, 1);
}

module.exports = { run };
