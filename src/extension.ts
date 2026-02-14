import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

const PREVIEW_TYPE = "lilypondPreview";
const PREVIEW_TITLE = "LilyPond Preview";
const DEFAULT_RENDER_DELAY_MS = 600;
const DEFAULT_MIN_INTERVAL_MS = 1200;
const DEFAULT_REFRESH_MODE: RefreshMode = "idleAndSave";
const CANCEL_GRACE_MS = 1200;

type RefreshMode = "idleAndSave" | "saveOnly" | "manual" | "live";
type RenderReason = "open" | "manual" | "typing" | "save" | "editorSwitch";

type ScheduledRender = {
  timer: NodeJS.Timeout;
  document: vscode.TextDocument;
  version: number;
  reason: RenderReason;
};

type InFlightRender = {
  token: number;
  uri: string;
  version: number;
  startedAt: number;
  process: ChildProcessWithoutNullStreams;
  killTimer?: NodeJS.Timeout;
};

type RenderOutput = {
  pagesHtml: string;
  pagesCount: number;
  command: string;
  stderr: string;
  elapsedMs: number;
};

type TextEditTarget = {
  filePath: string;
  line: number;
  column: number;
  endColumn?: number;
};

let extensionContext: vscode.ExtensionContext | undefined;
let previewPanel: vscode.WebviewPanel | undefined;
let previewDocumentUri: string | undefined;
let scheduledRender: ScheduledRender | undefined;
let inFlightRender: InFlightRender | undefined;
let renderToken = 0;
let outputChannel: vscode.OutputChannel | undefined;

const canceledTokens = new Set<number>();
const lastRequestedVersionByUri = new Map<string, number>();
const lastCompletedVersionByUri = new Map<string, number>();
const lastRenderStartByUri = new Map<string, number>();

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  outputChannel = vscode.window.createOutputChannel("LilyPond Preview");
  context.subscriptions.push(outputChannel);
  log("Extension activated.");

  void ensureStorageDirectories();

  const openPreview = vscode.commands.registerCommand("lilypond.preview", async () => {
    log("Command: lilypond.preview");
    const panel = ensurePreviewPanel(true);
    const document = getCurrentLilyPondDocument();

    if (!document) {
      postStatus("idle", "Open a LilyPond file (.ly, .ily, .lyi) to render a preview.");
      return;
    }

    previewDocumentUri = document.uri.toString();
    panel.title = `${PREVIEW_TITLE}: ${path.basename(document.fileName)}`;
    await requestRender(document, "open", true);
  });

  const refreshNow = vscode.commands.registerCommand("lilypond.preview.refreshNow", async () => {
    log("Command: lilypond.preview.refreshNow");
    const document = getPreviewDocument();
    if (!document) {
      void vscode.window.showInformationMessage("No active LilyPond document selected for preview.");
      return;
    }

    ensurePreviewPanel(true);
    await requestRender(document, "manual", true);
  });

  const toggleAutoRefresh = vscode.commands.registerCommand("lilypond.preview.toggleAutoRefresh", async () => {
    log("Command: lilypond.preview.toggleAutoRefresh");
    const config = vscode.workspace.getConfiguration("lilypond.preview");
    const mode = getRefreshMode(config);
    const nextMode: RefreshMode = mode === "manual" ? "idleAndSave" : "manual";
    const hasWorkspace = Array.isArray(vscode.workspace.workspaceFolders) && vscode.workspace.workspaceFolders.length > 0;
    const target = hasWorkspace ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await config.update("refreshMode", nextMode, target);
    void vscode.window.showInformationMessage(`LilyPond preview refresh mode: ${nextMode}`);
  });

  const onSave = vscode.workspace.onDidSaveTextDocument(async (document) => {
    if (!shouldTrackDocument(document)) {
      return;
    }

    const mode = getRefreshMode();
    if (mode === "saveOnly" || mode === "idleAndSave") {
      cancelScheduledRenderIfSameVersion(document);
      await requestRender(document, "save");
    }
  });

  const onType = vscode.workspace.onDidChangeTextDocument((event) => {
    const document = event.document;
    if (!shouldTrackDocument(document)) {
      return;
    }

    const mode = getRefreshMode();
    if (mode !== "idleAndSave" && mode !== "live") {
      return;
    }

    scheduleTypingRender(document, mode);
  });

  const onEditorChange = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
    if (!editor || !previewPanel || !isLilyPondDocument(editor.document)) {
      return;
    }

    previewDocumentUri = editor.document.uri.toString();
    previewPanel.title = `${PREVIEW_TITLE}: ${path.basename(editor.document.fileName)}`;

    if (getRefreshMode() !== "manual") {
      await requestRender(editor.document, "editorSwitch");
    }
  });

  const onSelectionChange = vscode.window.onDidChangeTextEditorSelection((event) => {
    if (!getCursorHighlightEnabled()) {
      postCursorClear();
      return;
    }

    if (!shouldTrackDocument(event.textEditor.document)) {
      return;
    }

    const active = event.selections[0]?.active;
    if (!active) {
      return;
    }

    postCursorPosition({
      filePath: event.textEditor.document.uri.fsPath,
      line: active.line + 1,
      column: active.character + 1
    });
  });

  const onConfigChange = vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration("lilypond.preview.cursorHighlightEnabled")) {
      return;
    }

    if (!getCursorHighlightEnabled()) {
      postCursorClear();
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor || !shouldTrackDocument(editor.document)) {
      return;
    }
    postCursorPosition({
      filePath: editor.document.uri.fsPath,
      line: editor.selection.active.line + 1,
      column: editor.selection.active.character + 1
    });
  });

  context.subscriptions.push(
    openPreview,
    refreshNow,
    toggleAutoRefresh,
    onSave,
    onType,
    onEditorChange,
    onSelectionChange,
    onConfigChange
  );
}

export function deactivate(): void {
  previewPanel = undefined;
  previewDocumentUri = undefined;
  clearScheduledRender();
  cancelInFlightRender();
}

function ensurePreviewPanel(reveal: boolean): vscode.WebviewPanel {
  if (previewPanel) {
    if (reveal) {
      previewPanel.reveal(vscode.ViewColumn.Beside);
    }
    return previewPanel;
  }

  previewPanel = vscode.window.createWebviewPanel(PREVIEW_TYPE, PREVIEW_TITLE, vscode.ViewColumn.Beside, {
    enableScripts: true,
    retainContextWhenHidden: true
  });

  previewPanel.webview.html = getBasePreviewHtml(previewPanel.webview);
  previewPanel.webview.onDidReceiveMessage(async (message: unknown) => {
    if (!message || typeof message !== "object") {
      return;
    }

    const payload = message as { type?: string; href?: string; message?: string };
    log(`Webview message: ${payload.type ?? "unknown"}`);
    if (payload.type === "previewClick" && typeof payload.href === "string") {
      await revealTargetFromPreview(payload.href);
      return;
    }
    if (payload.type === "debug" && typeof payload.message === "string") {
      log(`Webview: ${payload.message}`);
      return;
    }

    if (payload.type === "previewReady") {
      if (!getCursorHighlightEnabled()) {
        postCursorClear();
        return;
      }
      const editor = vscode.window.activeTextEditor;
      if (editor && shouldTrackDocument(editor.document)) {
        const active = editor.selection.active;
        postCursorPosition({
          filePath: editor.document.uri.fsPath,
          line: active.line + 1,
          column: active.character + 1
        });
      }
    }
  });
  previewPanel.onDidDispose(() => {
    previewPanel = undefined;
    previewDocumentUri = undefined;
    clearScheduledRender();
    cancelInFlightRender();
  });

  postStatus("idle", "Preview ready.");
  return previewPanel;
}

function getPreviewDocument(): vscode.TextDocument | undefined {
  if (previewDocumentUri) {
    const current = vscode.workspace.textDocuments.find((document) => document.uri.toString() === previewDocumentUri);
    if (current && isLilyPondDocument(current)) {
      return current;
    }
  }

  return getCurrentLilyPondDocument();
}

function shouldTrackDocument(document: vscode.TextDocument): boolean {
  if (!previewPanel || !previewDocumentUri) {
    return false;
  }

  if (!previewPanel.visible) {
    return false;
  }

  return isLilyPondDocument(document) && previewDocumentUri === document.uri.toString();
}

function getCurrentLilyPondDocument(): vscode.TextDocument | undefined {
  const active = vscode.window.activeTextEditor?.document;
  if (active && isLilyPondDocument(active)) {
    return active;
  }

  return vscode.workspace.textDocuments.find((document) => isLilyPondDocument(document));
}

function isLilyPondDocument(document: vscode.TextDocument): boolean {
  if (document.languageId === "lilypond") {
    return true;
  }

  const extension = path.extname(document.fileName).toLowerCase();
  return extension === ".ly" || extension === ".ily" || extension === ".lyi";
}

function scheduleTypingRender(document: vscode.TextDocument, mode: RefreshMode): void {
  clearScheduledRender();

  const delayMs = getTypingDelayMs(mode);
  const timer = setTimeout(() => {
    scheduledRender = undefined;
    void requestRender(document, "typing");
  }, delayMs);

  scheduledRender = {
    timer,
    document,
    version: document.version,
    reason: "typing"
  };
}

function cancelScheduledRenderIfSameVersion(document: vscode.TextDocument): void {
  if (!scheduledRender) {
    return;
  }

  const sameUri = scheduledRender.document.uri.toString() === document.uri.toString();
  const sameVersion = scheduledRender.version === document.version;
  if (sameUri && sameVersion) {
    clearScheduledRender();
  }
}

function clearScheduledRender(): void {
  if (!scheduledRender) {
    return;
  }

  clearTimeout(scheduledRender.timer);
  scheduledRender = undefined;
}

async function requestRender(document: vscode.TextDocument, reason: RenderReason, force = false): Promise<void> {
  if (!previewPanel) {
    return;
  }

  const uri = document.uri.toString();
  if (!isLilyPondDocument(document)) {
    return;
  }

  if (!force && previewDocumentUri !== uri) {
    return;
  }

  if (!force && !previewPanel.visible && reason !== "manual" && reason !== "open") {
    return;
  }

  const completedVersion = lastCompletedVersionByUri.get(uri);
  if (!force && completedVersion === document.version) {
    return;
  }

  if (
    !force &&
    inFlightRender &&
    inFlightRender.uri === uri &&
    inFlightRender.version === document.version
  ) {
    return;
  }

  const minIntervalMs = getMinRenderIntervalMs();
  const lastStart = lastRenderStartByUri.get(uri);
  if (!force && reason === "typing" && typeof lastStart === "number") {
    const remaining = minIntervalMs - (Date.now() - lastStart);
    if (remaining > 0) {
      const timer = setTimeout(() => {
        scheduledRender = undefined;
        void requestRender(document, reason);
      }, remaining);
      scheduledRender = {
        timer,
        document,
        version: document.version,
        reason
      };
      return;
    }
  }

  await startRender(document, reason);
}

async function startRender(document: vscode.TextDocument, reason: RenderReason): Promise<void> {
  if (!previewPanel) {
    return;
  }

  const uri = document.uri.toString();
  const token = ++renderToken;
  const panel = previewPanel;
  log(`Render start: reason=${reason} token=${token} version=${document.version} file=${document.fileName}`);

  panel.title = `${PREVIEW_TITLE}: ${path.basename(document.fileName)}`;
  lastRequestedVersionByUri.set(uri, document.version);
  lastRenderStartByUri.set(uri, Date.now());

  if (getShowUpdatingBadge()) {
    postStatus("updating", `Rendering ${path.basename(document.fileName)}...`);
  }

  cancelInFlightRender();

  try {
    const output = await renderToSvg(document, token);

    if (!previewPanel || token !== renderToken || canceledTokens.has(token)) {
      return;
    }

    lastCompletedVersionByUri.set(uri, document.version);
    postUpdate({
      title: path.basename(document.fileName),
      pagesHtml: output.pagesHtml,
      pagesCount: output.pagesCount,
      statusText: `Rendered ${output.pagesCount === 1 ? "1 page" : `${output.pagesCount} pages`} in ${output.elapsedMs} ms`,
      command: output.command,
      stderr: output.stderr
    });
    log(`Render success: token=${token} pages=${output.pagesCount} elapsedMs=${output.elapsedMs}`);

    const active = vscode.window.activeTextEditor;
    if (active && shouldTrackDocument(active.document) && getCursorHighlightEnabled()) {
      postCursorPosition({
        filePath: active.document.uri.fsPath,
        line: active.selection.active.line + 1,
        column: active.selection.active.character + 1
      });
    }
  } catch (error) {
    if (!previewPanel || token !== renderToken || isCanceledError(error) || canceledTokens.has(token)) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    log(`Render error: token=${token} reason=${reason} message=${message}`);
    postStatus("error", message);

    if (reason === "manual" || reason === "open") {
      void vscode.window.showErrorMessage(`LilyPond preview failed: ${message}`);
    }
  } finally {
    canceledTokens.delete(token);
  }
}

async function renderToSvg(document: vscode.TextDocument, token: number): Promise<RenderOutput> {
  const { inputPath, outputBase, previewDir, sourceDir, lilypondPath, args, fontCacheDir } = await prepareRenderContext(document);
  const command = `${lilypondPath} ${args.map(quoteArg).join(" ")}`;

  await fs.writeFile(inputPath, document.getText(), "utf8");
  await cleanupPreviousOutputs(previewDir);

  const startedAt = Date.now();
  const stderr = await runLilypond({
    token,
    lilypondPath,
    args,
    cwd: sourceDir,
    fontCacheDir,
    uri: document.uri.toString(),
    version: document.version
  });

  const svgFiles = (await fs.readdir(previewDir))
    .filter((name) => name.startsWith("result") && name.endsWith(".svg"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (svgFiles.length === 0) {
    throw new Error("LilyPond completed without generating SVG output.");
  }

  const pagesHtml = (
    await Promise.all(
      svgFiles.map(async (fileName, index) => {
        const rawSvg = await fs.readFile(path.join(previewDir, fileName), "utf8");
        const rewrittenSvg = rewriteTexteditTargets(rawSvg, inputPath, document.fileName);
        const safeSvg = stripScriptTags(rewrittenSvg);
        return `<section class=\"page\"><div class=\"page-title\">Page ${index + 1}</div><div class=\"svg-wrap\">${safeSvg}</div></section>`;
      })
    )
  ).join("\n");

  return {
    pagesHtml,
    pagesCount: svgFiles.length,
    command,
    stderr,
    elapsedMs: Date.now() - startedAt
  };
}

async function prepareRenderContext(document: vscode.TextDocument): Promise<{
  previewDir: string;
  inputPath: string;
  outputBase: string;
  sourceDir: string;
  lilypondPath: string;
  args: string[];
  fontCacheDir: string;
}> {
  if (!extensionContext) {
    throw new Error("Extension context is not initialized.");
  }

  const config = vscode.workspace.getConfiguration("lilypond.preview");
  const lilypondPath = config.get<string>("lilypondPath")?.trim() || "lilypond";

  const docKey = Buffer.from(document.uri.toString(), "utf8").toString("base64url");
  const previewDir = path.join(extensionContext.globalStorageUri.fsPath, "preview-cache", docKey);
  const fontCacheDir = path.join(extensionContext.globalStorageUri.fsPath, "font-cache");
  const inputPath = path.join(previewDir, "input.ly");
  const outputBase = path.join(previewDir, "result");
  const sourceDir = path.dirname(document.fileName);

  await fs.mkdir(previewDir, { recursive: true });
  await fs.mkdir(fontCacheDir, { recursive: true });

  const args = ["-dbackend=svg", "-dpoint-and-click", "-o", outputBase, "-I", sourceDir, inputPath];

  return {
    previewDir,
    inputPath,
    outputBase,
    sourceDir,
    lilypondPath,
    args,
    fontCacheDir
  };
}

async function cleanupPreviousOutputs(previewDir: string): Promise<void> {
  const entries = await fs.readdir(previewDir);
  await Promise.all(
    entries
      .filter((entry) => entry.startsWith("result") && entry.endsWith(".svg"))
      .map(async (entry) => fs.unlink(path.join(previewDir, entry)))
  );
}

async function runLilypond(input: {
  token: number;
  lilypondPath: string;
  args: string[];
  cwd: string;
  fontCacheDir: string;
  uri: string;
  version: number;
}): Promise<string> {
  const child = spawn(input.lilypondPath, input.args, {
    cwd: input.cwd,
    windowsHide: true,
    env: {
      ...process.env,
      XDG_CACHE_HOME: input.fontCacheDir
    }
  });

  inFlightRender = {
    token: input.token,
    uri: input.uri,
    version: input.version,
    startedAt: Date.now(),
    process: child
  };

  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  await new Promise<void>((resolve, reject) => {
    child.once("error", (error) => {
      clearInFlight(input.token);
      reject(error);
    });

    child.once("close", (code, signal) => {
      clearInFlight(input.token);

      if (canceledTokens.has(input.token)) {
        reject(new RenderCanceledError("Render canceled."));
        return;
      }

      if (code === 0) {
        resolve();
        return;
      }

      const trimmedStderr = stderr.trim();
      const detail =
        trimmedStderr ||
        `LilyPond exited with code ${typeof code === "number" ? String(code) : "unknown"}${
          signal ? ` (signal ${signal})` : ""
        }.`;
      reject(new Error(detail));
    });
  });

  return stderr;
}

function cancelInFlightRender(): void {
  if (!inFlightRender) {
    return;
  }

  const current = inFlightRender;
  canceledTokens.add(current.token);

  try {
    current.process.kill("SIGTERM");
  } catch {
    // Ignore kill errors when process already ended.
  }

  current.killTimer = setTimeout(() => {
    if (!inFlightRender || inFlightRender.token !== current.token) {
      return;
    }

    try {
      inFlightRender.process.kill("SIGKILL");
    } catch {
      // Ignore kill errors when process already ended.
    }
  }, CANCEL_GRACE_MS);
}

function clearInFlight(token: number): void {
  if (!inFlightRender || inFlightRender.token !== token) {
    return;
  }

  if (inFlightRender.killTimer) {
    clearTimeout(inFlightRender.killTimer);
  }

  inFlightRender = undefined;
}

async function ensureStorageDirectories(): Promise<void> {
  if (!extensionContext) {
    return;
  }

  await Promise.all([
    fs.mkdir(path.join(extensionContext.globalStorageUri.fsPath, "preview-cache"), { recursive: true }),
    fs.mkdir(path.join(extensionContext.globalStorageUri.fsPath, "font-cache"), { recursive: true })
  ]);
}

function postStatus(state: "idle" | "updating" | "error", message: string): void {
  if (!previewPanel) {
    return;
  }

  void previewPanel.webview.postMessage({
    type: "status",
    state,
    message
  });
  log(`Status: ${state} | ${message}`);
}

function postUpdate(input: {
  title: string;
  pagesHtml: string;
  pagesCount: number;
  statusText: string;
  command: string;
  stderr: string;
}): void {
  if (!previewPanel) {
    return;
  }

  void previewPanel.webview.postMessage({
    type: "update",
    title: input.title,
    pagesHtml: input.pagesHtml,
    pagesCount: input.pagesCount,
    statusText: input.statusText,
    command: input.command,
    stderr: input.stderr
  });
}

function postCursorPosition(cursor: { filePath: string; line: number; column: number }): void {
  if (!previewPanel) {
    return;
  }

  void previewPanel.webview.postMessage({
    type: "cursor",
    filePath: cursor.filePath,
    line: cursor.line,
    column: cursor.column,
    autoScroll: getAutoScrollToHighlight()
  });
  log(`Cursor: ${cursor.filePath}:${cursor.line}:${cursor.column}`);
}

function postCursorClear(): void {
  if (!previewPanel) {
    return;
  }

  void previewPanel.webview.postMessage({
    type: "cursorClear"
  });
  log("Cursor highlight cleared.");
}

async function revealTargetFromPreview(href: string): Promise<void> {
  const target = parseTextEditHref(href);
  if (!target) {
    log(`Preview click ignored: could not parse href=${href}`);
    return;
  }

  try {
    const uri = vscode.Uri.file(target.filePath);
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One, false);

    const lineIndex = Math.max(0, Math.min(document.lineCount - 1, target.line - 1));
    const lineText = document.lineAt(lineIndex).text;
    const startColumn = Math.max(0, Math.min(lineText.length, target.column - 1));
    const endColumn = Math.max(startColumn, Math.min(lineText.length, (target.endColumn ?? target.column) - 1));
    const start = new vscode.Position(lineIndex, startColumn);
    const end = new vscode.Position(lineIndex, endColumn);

    editor.selection = new vscode.Selection(start, end);
    editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  } catch {
    // Ignore navigation failures from stale or non-local targets.
    log(`Preview click navigation failed: href=${href}`);
  }
}

function rewriteTexteditTargets(svg: string, originalPath: string, sourcePath: string): string {
  const normalizedOriginal = normalizeFsPath(originalPath);
  const escapedSource = encodeURI(sourcePath);
  return svg.replace(/textedit:\/\/[^"]+/g, (value) => {
    const parsed = parseTextEditHref(value);
    if (!parsed) {
      return value;
    }

    if (normalizeFsPath(parsed.filePath) !== normalizedOriginal) {
      return value;
    }

    const endPart = typeof parsed.endColumn === "number" ? `:${parsed.endColumn}` : "";
    return `textedit://${escapedSource}:${parsed.line}:${parsed.column}${endPart}`;
  });
}

function parseTextEditHref(href: string): TextEditTarget | undefined {
  if (!href.startsWith("textedit://")) {
    return undefined;
  }

  const withoutScheme = decodeURIComponent(href.slice("textedit://".length));
  const segments = withoutScheme.split(":");
  if (segments.length < 3) {
    return undefined;
  }

  const last = segments[segments.length - 1];
  const secondLast = segments[segments.length - 2];
  const thirdLast = segments[segments.length - 3];

  if (!/^\d+$/.test(last) || !/^\d+$/.test(secondLast)) {
    return undefined;
  }

  const hasEndColumn = /^\d+$/.test(thirdLast);
  const filePath = segments.slice(0, hasEndColumn ? -3 : -2).join(":");
  const line = Number(hasEndColumn ? thirdLast : secondLast);
  const column = Number(hasEndColumn ? secondLast : last);
  const endColumn = hasEndColumn ? Number(last) : undefined;

  if (!Number.isFinite(line) || !Number.isFinite(column)) {
    return undefined;
  }

  return {
    filePath,
    line,
    column,
    endColumn
  };
}

function normalizeFsPath(filePath: string): string {
  return path.normalize(filePath).toLowerCase();
}

function getRefreshMode(config?: vscode.WorkspaceConfiguration): RefreshMode {
  const resolved = (config ?? vscode.workspace.getConfiguration("lilypond.preview")).get<string>(
    "refreshMode",
    DEFAULT_REFRESH_MODE
  );

  if (resolved === "saveOnly" || resolved === "manual" || resolved === "live" || resolved === "idleAndSave") {
    return resolved;
  }

  return DEFAULT_REFRESH_MODE;
}

function getTypingDelayMs(mode: RefreshMode): number {
  const config = vscode.workspace.getConfiguration("lilypond.preview");
  const configuredDelay = config.get<number>("renderDelayMs", DEFAULT_RENDER_DELAY_MS);
  const baseline = Number.isFinite(configuredDelay) ? Math.max(100, configuredDelay) : DEFAULT_RENDER_DELAY_MS;

  if (mode === "live") {
    return Math.max(120, Math.min(350, baseline));
  }

  return baseline;
}

function getMinRenderIntervalMs(): number {
  const config = vscode.workspace.getConfiguration("lilypond.preview");
  const configured = config.get<number>("minRenderIntervalMs", DEFAULT_MIN_INTERVAL_MS);
  return Number.isFinite(configured) ? Math.max(100, configured) : DEFAULT_MIN_INTERVAL_MS;
}

function getShowUpdatingBadge(): boolean {
  const config = vscode.workspace.getConfiguration("lilypond.preview");
  return config.get<boolean>("showUpdatingBadge", true);
}

function getCursorHighlightEnabled(): boolean {
  const config = vscode.workspace.getConfiguration("lilypond.preview");
  return config.get<boolean>("cursorHighlightEnabled", true);
}

function getAutoScrollToHighlight(): boolean {
  const config = vscode.workspace.getConfiguration("lilypond.preview");
  return config.get<boolean>("autoScrollToHighlight", true);
}

function isCanceledError(error: unknown): boolean {
  return error instanceof RenderCanceledError;
}

class RenderCanceledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderCanceledError";
  }
}

function stripScriptTags(value: string): string {
  return value.replace(/<script[\s\S]*?<\/script>/gi, "");
}

function quoteArg(value: string): string {
  if (/^[a-zA-Z0-9_./:-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

function getBasePreviewHtml(webview: vscode.Webview): string {
  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>LilyPond Preview</title>
    <style>
      :root {
        font-family: "Segoe UI", Arial, sans-serif;
      }
      body {
        margin: 0;
        padding: 14px;
        background: #f5f6f9;
        color: #1f2430;
      }
      .header {
        background: #fff;
        border: 1px solid #d9dde8;
        border-radius: 10px;
        padding: 12px;
        margin-bottom: 14px;
      }
      .top-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
      }
      h1 {
        margin: 0;
        font-size: 15px;
      }
      .badge {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        border-radius: 999px;
        padding: 3px 8px;
        border: 1px solid #c8cde0;
        color: #4f5772;
        background: #eef2ff;
      }
      .badge[data-state="updating"] {
        color: #1b4d8c;
        border-color: #b2cef4;
        background: #e8f1ff;
      }
      .badge[data-state="error"] {
        color: #8e1f1f;
        border-color: #f0baba;
        background: #ffecec;
      }
      .status-line {
        margin: 8px 0 0;
        font-size: 12px;
        color: #555e79;
      }
      .meta {
        margin-top: 10px;
        display: grid;
        gap: 8px;
      }
      .meta-label {
        font-size: 11px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #646f8e;
      }
      code, pre {
        margin: 0;
        font-family: Menlo, Consolas, monospace;
        font-size: 12px;
        border-radius: 7px;
        padding: 8px;
      }
      code {
        display: block;
        background: #edf1fb;
        color: #1d2740;
        overflow-x: auto;
      }
      pre {
        background: #11151f;
        color: #f2f5fb;
        overflow: auto;
        max-height: 160px;
      }
      .pages {
        display: grid;
        gap: 14px;
      }
      .page {
        background: #fff;
        border: 1px solid #d9dde8;
        border-radius: 10px;
        padding: 10px;
      }
      .page-title {
        margin-bottom: 8px;
        font-size: 11px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #5f6782;
      }
      .svg-wrap {
        overflow: auto;
      }
      .svg-wrap svg {
        max-width: 100%;
        height: auto;
        display: block;
      }
      a.pnc-anchor {
        cursor: pointer;
      }
      a.pnc-anchor.pnc-selected path,
      a.pnc-anchor.pnc-selected rect,
      a.pnc-anchor.pnc-selected polygon,
      a.pnc-anchor.pnc-selected ellipse,
      a.pnc-anchor.pnc-selected circle,
      a.pnc-anchor.pnc-selected text,
      a.pnc-anchor.pnc-selected tspan,
      a.pnc-anchor.pnc-selected line,
      a.pnc-anchor.pnc-selected polyline,
      a.pnc-anchor.pnc-selected use {
        fill: #c21833 !important;
        stroke: #7d1022 !important;
        stroke-width: 0.2;
      }
      .empty {
        border: 1px dashed #c7cee1;
        border-radius: 10px;
        padding: 24px;
        text-align: center;
        color: #5f6782;
        background: #fff;
      }
    </style>
  </head>
  <body>
    <section class="header">
      <div class="top-row">
        <h1 id="doc-title">LilyPond Preview</h1>
        <span id="state-badge" class="badge" data-state="idle">Idle</span>
      </div>
      <p id="status-line" class="status-line">Preview ready.</p>
      <div class="meta">
        <div>
          <div class="meta-label">Command</div>
          <code id="command-line"></code>
        </div>
        <div>
          <div class="meta-label">LilyPond Output</div>
          <pre id="stderr-output"></pre>
        </div>
      </div>
    </section>

    <main id="pages" class="pages">
      <div class="empty">No rendered pages yet.</div>
    </main>

    <script nonce="${nonce}">
      const vscodeApi = acquireVsCodeApi();
      const docTitle = document.getElementById("doc-title");
      const badge = document.getElementById("state-badge");
      const statusLine = document.getElementById("status-line");
      const pages = document.getElementById("pages");
      const commandLine = document.getElementById("command-line");
      const stderrOutput = document.getElementById("stderr-output");
      let pointAnchors = [];
      let currentSelectedAnchor = null;

      function setStatus(state, message) {
        badge.dataset.state = state;
        badge.textContent = state === "updating" ? "Updating" : state === "error" ? "Error" : "Idle";
        statusLine.textContent = message || "";
      }

      function normalizeFilePath(value) {
        return String(value || "").replace(/\\\\/g, "/").toLowerCase();
      }

      function parseTextEditHref(href) {
        if (typeof href !== "string" || !href.startsWith("textedit://")) {
          return null;
        }

        const raw = decodeURIComponent(href.slice("textedit://".length));
        const segments = raw.split(":");
        if (segments.length < 3) {
          return null;
        }

        const last = segments[segments.length - 1];
        const secondLast = segments[segments.length - 2];
        const thirdLast = segments[segments.length - 3];
        if (!/^\\d+$/.test(last) || !/^\\d+$/.test(secondLast)) {
          return null;
        }

        const hasEndColumn = /^\\d+$/.test(thirdLast);
        const filePath = segments.slice(0, hasEndColumn ? -3 : -2).join(":");
        const line = Number(hasEndColumn ? thirdLast : secondLast);
        const column = Number(hasEndColumn ? secondLast : last);
        const endColumn = hasEndColumn ? Number(last) : column;
        if (!Number.isFinite(line) || !Number.isFinite(column) || !Number.isFinite(endColumn)) {
          return null;
        }

        return {
          filePath,
          line,
          column,
          endColumn
        };
      }

      function clearSelectedAnchor() {
        if (currentSelectedAnchor) {
          currentSelectedAnchor.classList.remove("pnc-selected");
          currentSelectedAnchor = null;
        }
      }

      function bindPointAnchors() {
        pointAnchors = [];
        clearSelectedAnchor();

        const anchors = pages.querySelectorAll("a");
        anchors.forEach((anchor) => {
          const href = anchor.getAttribute("xlink:href") || anchor.getAttribute("href");
          const target = parseTextEditHref(href);
          if (!target) {
            return;
          }

          anchor.classList.add("pnc-anchor");
          anchor.addEventListener("click", (event) => {
            event.preventDefault();
            vscodeApi.postMessage({
              type: "previewClick",
              href
            });
          });

          pointAnchors.push({
            anchor,
            href,
            target,
            normalizedFilePath: normalizeFilePath(target.filePath)
          });
        });

        vscodeApi.postMessage({
          type: "debug",
          message: "anchorCount=" + pointAnchors.length
        });
      }

      function pickBestAnchor(cursorFilePath, line, column) {
        if (!pointAnchors.length) {
          return null;
        }

        const normalizedCursorPath = normalizeFilePath(cursorFilePath);
        const fileMatched = pointAnchors.filter((item) => item.normalizedFilePath === normalizedCursorPath);
        const candidates = fileMatched.length > 0 ? fileMatched : pointAnchors;

        const sameLine = candidates.filter((item) => item.target.line === line);
        const pool = sameLine.length > 0 ? sameLine : candidates;

        let best = null;
        let bestScore = Number.POSITIVE_INFINITY;
        for (const item of pool) {
          const lineDelta = Math.abs(item.target.line - line);
          const startCol = Number(item.target.column);
          const endCol = Number(item.target.endColumn || item.target.column);
          const span = Math.max(0, endCol - startCol);
          const inRange = lineDelta === 0 && column >= startCol && column <= endCol;

          let colDelta = 0;
          if (column < startCol) {
            colDelta = startCol - column;
          } else if (column > endCol) {
            colDelta = column - endCol;
          }
          const center = (startCol + endCol) / 2;
          const centerDelta = Math.abs(column - center);
          const selectionPenalty = currentSelectedAnchor === item.anchor ? -0.25 : 0;
          const score = lineDelta * 100000 + (inRange ? 0 : 1500) + colDelta * 10 + centerDelta + span * 0.05 + selectionPenalty;
          if (score < bestScore) {
            bestScore = score;
            best = item;
          }
        }
        return best;
      }

      function highlightForCursor(payload) {
        const line = Number(payload.line);
        const column = Number(payload.column);
        if (!Number.isFinite(line) || !Number.isFinite(column)) {
          return;
        }

        const best = pickBestAnchor(payload.filePath || "", line, column);
        if (!best) {
          clearSelectedAnchor();
          vscodeApi.postMessage({
            type: "debug",
            message: "cursor-no-match " + (payload.filePath || "") + ":" + line + ":" + column
          });
          return;
        }

        if (currentSelectedAnchor && currentSelectedAnchor !== best.anchor) {
          currentSelectedAnchor.classList.remove("pnc-selected");
        }

        currentSelectedAnchor = best.anchor;
        currentSelectedAnchor.classList.add("pnc-selected");
        if (payload.autoScroll && typeof currentSelectedAnchor.scrollIntoView === "function") {
          currentSelectedAnchor.scrollIntoView({
            block: "center",
            inline: "center",
            behavior: "smooth"
          });
        }
        vscodeApi.postMessage({
          type: "debug",
          message:
            "cursor-match " +
            (payload.filePath || "") +
            ":" +
            line +
            ":" +
            column +
            " -> " +
            best.target.filePath +
            ":" +
            best.target.line +
            ":" +
            best.target.column
        });
      }

      window.addEventListener("message", (event) => {
        const message = event.data;
        if (!message || typeof message !== "object") {
          return;
        }

        if (message.type === "status") {
          setStatus(message.state, message.message);
          return;
        }

        if (message.type === "update") {
          const previousScroll = document.scrollingElement ? document.scrollingElement.scrollTop : 0;
          if (typeof message.title === "string" && message.title.length > 0) {
            docTitle.textContent = message.title;
          }
          setStatus("idle", message.statusText || "Rendered.");
          commandLine.textContent = message.command || "";
          stderrOutput.textContent = message.stderr || "";
          pages.innerHTML = message.pagesHtml && message.pagesHtml.length > 0
            ? message.pagesHtml
            : '<div class="empty">No rendered pages yet.</div>';
          bindPointAnchors();

          if (document.scrollingElement) {
            document.scrollingElement.scrollTop = previousScroll;
          }
          return;
        }

        if (message.type === "cursor") {
          highlightForCursor(message);
          return;
        }

        if (message.type === "cursorClear") {
          clearSelectedAnchor();
        }
      });

      vscodeApi.postMessage({ type: "previewReady" });
    </script>
  </body>
</html>`;
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

function log(message: string): void {
  if (!outputChannel) {
    return;
  }
  outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
}
