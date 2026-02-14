import { ChildProcessWithoutNullStreams } from "child_process";
import * as path from "path";
import * as vscode from "vscode";
import {
  getAutoScrollToHighlight,
  getCursorHighlightEnabled,
  getMinRenderIntervalMs,
  getRefreshMode,
  getShowUpdatingBadge,
  getTypingDelayMs,
  type RefreshMode
} from "../config/settings";
import { log } from "../log/logger";
import { CANCEL_GRACE_MS, LilypondRenderer, type RenderOutput } from "../render/LilypondRenderer";
import { parseTextEditHref } from "../sync/textEdit";
import { getBasePreviewHtml } from "../webview/template";

const PREVIEW_TYPE = "lilypondPreview";
const PREVIEW_TITLE = "LilyPond Preview";

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
  process: ChildProcessWithoutNullStreams;
  killTimer?: NodeJS.Timeout;
};

export class PreviewController {
  private readonly context: vscode.ExtensionContext;
  private readonly renderer: LilypondRenderer;

  private previewPanel: vscode.WebviewPanel | undefined;
  private previewDocumentUri: string | undefined;
  private scheduledRender: ScheduledRender | undefined;
  private inFlightRender: InFlightRender | undefined;
  private renderToken = 0;

  private readonly canceledTokens = new Set<number>();
  private readonly lastCompletedVersionByUri = new Map<string, number>();
  private readonly lastRenderStartByUri = new Map<string, number>();

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.renderer = new LilypondRenderer(context);
  }

  async initialize(): Promise<void> {
    await this.renderer.ensureStorageDirectories();
  }

  register(): void {
    const openPreview = vscode.commands.registerCommand("lilypond.preview", async () => {
      log("Command: lilypond.preview");
      const panel = this.ensurePreviewPanel(true);
      const document = this.getCurrentLilyPondDocument();

      if (!document) {
        this.postStatus("idle", "Open a LilyPond file (.ly, .ily, .lyi) to render a preview.");
        return;
      }

      this.previewDocumentUri = document.uri.toString();
      panel.title = `${PREVIEW_TITLE}: ${path.basename(document.fileName)}`;
      await this.requestRender(document, "open", true);
    });

    const refreshNow = vscode.commands.registerCommand("lilypond.preview.refreshNow", async () => {
      log("Command: lilypond.preview.refreshNow");
      const document = this.getPreviewDocument();
      if (!document) {
        void vscode.window.showInformationMessage("No active LilyPond document selected for preview.");
        return;
      }

      this.ensurePreviewPanel(true);
      await this.requestRender(document, "manual", true);
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
      if (!this.shouldTrackDocument(document)) {
        return;
      }

      const mode = getRefreshMode();
      if (mode === "saveOnly" || mode === "idleAndSave") {
        this.cancelScheduledRenderIfSameVersion(document);
        await this.requestRender(document, "save");
      }
    });

    const onType = vscode.workspace.onDidChangeTextDocument((event) => {
      const document = event.document;
      if (!this.shouldTrackDocument(document)) {
        return;
      }

      const mode = getRefreshMode();
      if (mode !== "idleAndSave" && mode !== "live") {
        return;
      }

      this.scheduleTypingRender(document, mode);
    });

    const onEditorChange = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      if (!editor || !this.previewPanel || !this.isLilyPondDocument(editor.document)) {
        return;
      }

      this.previewDocumentUri = editor.document.uri.toString();
      this.previewPanel.title = `${PREVIEW_TITLE}: ${path.basename(editor.document.fileName)}`;

      if (getRefreshMode() !== "manual") {
        await this.requestRender(editor.document, "editorSwitch");
      }
    });

    const onSelectionChange = vscode.window.onDidChangeTextEditorSelection((event) => {
      if (!getCursorHighlightEnabled()) {
        this.postCursorClear();
        return;
      }

      if (!this.shouldTrackDocument(event.textEditor.document)) {
        return;
      }

      const active = event.selections[0]?.active;
      if (!active) {
        return;
      }

      this.postCursorPosition({
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
        this.postCursorClear();
        return;
      }

      const editor = vscode.window.activeTextEditor;
      if (!editor || !this.shouldTrackDocument(editor.document)) {
        return;
      }

      this.postCursorPosition({
        filePath: editor.document.uri.fsPath,
        line: editor.selection.active.line + 1,
        column: editor.selection.active.character + 1
      });
    });

    this.context.subscriptions.push(
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

  deactivate(): void {
    this.previewPanel = undefined;
    this.previewDocumentUri = undefined;
    this.clearScheduledRender();
    this.cancelInFlightRender();
  }

  private ensurePreviewPanel(reveal: boolean): vscode.WebviewPanel {
    if (this.previewPanel) {
      if (reveal) {
        this.previewPanel.reveal(vscode.ViewColumn.Beside);
      }
      return this.previewPanel;
    }

    this.previewPanel = vscode.window.createWebviewPanel(PREVIEW_TYPE, PREVIEW_TITLE, vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true
    });

    this.previewPanel.webview.html = getBasePreviewHtml();
    this.previewPanel.webview.onDidReceiveMessage(async (message: unknown) => {
      if (!message || typeof message !== "object") {
        return;
      }

      const payload = message as { type?: string; href?: string; message?: string };
      log(`Webview message: ${payload.type ?? "unknown"}`);

      if (payload.type === "previewClick" && typeof payload.href === "string") {
        await this.revealTargetFromPreview(payload.href);
        return;
      }

      if (payload.type === "debug" && typeof payload.message === "string") {
        log(`Webview: ${payload.message}`);
        return;
      }

      if (payload.type === "previewReady") {
        if (!getCursorHighlightEnabled()) {
          this.postCursorClear();
          return;
        }

        const editor = vscode.window.activeTextEditor;
        if (editor && this.shouldTrackDocument(editor.document)) {
          const active = editor.selection.active;
          this.postCursorPosition({
            filePath: editor.document.uri.fsPath,
            line: active.line + 1,
            column: active.character + 1
          });
        }
      }
    });

    this.previewPanel.onDidDispose(() => {
      this.previewPanel = undefined;
      this.previewDocumentUri = undefined;
      this.clearScheduledRender();
      this.cancelInFlightRender();
    });

    this.postStatus("idle", "Preview ready.");
    return this.previewPanel;
  }

  private getPreviewDocument(): vscode.TextDocument | undefined {
    if (this.previewDocumentUri) {
      const current = vscode.workspace.textDocuments.find((document) => document.uri.toString() === this.previewDocumentUri);
      if (current && this.isLilyPondDocument(current)) {
        return current;
      }
    }

    return this.getCurrentLilyPondDocument();
  }

  private shouldTrackDocument(document: vscode.TextDocument): boolean {
    if (!this.previewPanel || !this.previewDocumentUri) {
      return false;
    }

    if (!this.previewPanel.visible) {
      return false;
    }

    return this.isLilyPondDocument(document) && this.previewDocumentUri === document.uri.toString();
  }

  private getCurrentLilyPondDocument(): vscode.TextDocument | undefined {
    const active = vscode.window.activeTextEditor?.document;
    if (active && this.isLilyPondDocument(active)) {
      return active;
    }

    return vscode.workspace.textDocuments.find((document) => this.isLilyPondDocument(document));
  }

  private isLilyPondDocument(document: vscode.TextDocument): boolean {
    if (document.languageId === "lilypond") {
      return true;
    }

    const extension = path.extname(document.fileName).toLowerCase();
    return extension === ".ly" || extension === ".ily" || extension === ".lyi";
  }

  private scheduleTypingRender(document: vscode.TextDocument, mode: RefreshMode): void {
    this.clearScheduledRender();

    const delayMs = getTypingDelayMs(mode);
    const timer = setTimeout(() => {
      this.scheduledRender = undefined;
      void this.requestRender(document, "typing");
    }, delayMs);

    this.scheduledRender = {
      timer,
      document,
      version: document.version,
      reason: "typing"
    };
  }

  private cancelScheduledRenderIfSameVersion(document: vscode.TextDocument): void {
    if (!this.scheduledRender) {
      return;
    }

    const sameUri = this.scheduledRender.document.uri.toString() === document.uri.toString();
    const sameVersion = this.scheduledRender.version === document.version;
    if (sameUri && sameVersion) {
      this.clearScheduledRender();
    }
  }

  private clearScheduledRender(): void {
    if (!this.scheduledRender) {
      return;
    }

    clearTimeout(this.scheduledRender.timer);
    this.scheduledRender = undefined;
  }

  private async requestRender(document: vscode.TextDocument, reason: RenderReason, force = false): Promise<void> {
    if (!this.previewPanel) {
      return;
    }

    const uri = document.uri.toString();
    if (!this.isLilyPondDocument(document)) {
      return;
    }

    if (!force && this.previewDocumentUri !== uri) {
      return;
    }

    if (!force && !this.previewPanel.visible && reason !== "manual" && reason !== "open") {
      return;
    }

    const completedVersion = this.lastCompletedVersionByUri.get(uri);
    if (!force && completedVersion === document.version) {
      return;
    }

    if (!force && this.inFlightRender && this.inFlightRender.uri === uri && this.inFlightRender.version === document.version) {
      return;
    }

    const minIntervalMs = getMinRenderIntervalMs();
    const lastStart = this.lastRenderStartByUri.get(uri);
    if (!force && reason === "typing" && typeof lastStart === "number") {
      const remaining = minIntervalMs - (Date.now() - lastStart);
      if (remaining > 0) {
        const timer = setTimeout(() => {
          this.scheduledRender = undefined;
          void this.requestRender(document, reason);
        }, remaining);

        this.scheduledRender = {
          timer,
          document,
          version: document.version,
          reason
        };
        return;
      }
    }

    await this.startRender(document, reason);
  }

  private async startRender(document: vscode.TextDocument, reason: RenderReason): Promise<void> {
    if (!this.previewPanel) {
      return;
    }

    const uri = document.uri.toString();
    const token = ++this.renderToken;

    this.previewPanel.title = `${PREVIEW_TITLE}: ${path.basename(document.fileName)}`;
    this.lastRenderStartByUri.set(uri, Date.now());
    log(`Render start: reason=${reason} token=${token} version=${document.version} file=${document.fileName}`);

    if (getShowUpdatingBadge()) {
      this.postStatus("updating", `Rendering ${path.basename(document.fileName)}...`);
    }

    this.cancelInFlightRender();

    try {
      const output = await this.renderer.renderDocument(
        document,
        token,
        ({ process, uri: renderUri, version, token: renderToken }) => {
          this.inFlightRender = {
            token: renderToken,
            uri: renderUri,
            version,
            process
          };
        },
        (clearedToken) => {
          this.clearInFlight(clearedToken);
        }
      );

      if (!this.previewPanel || token !== this.renderToken || this.canceledTokens.has(token)) {
        return;
      }

      this.lastCompletedVersionByUri.set(uri, document.version);
      this.postUpdate(output, document.fileName);
      log(`Render success: token=${token} pages=${output.pagesCount} elapsedMs=${output.elapsedMs}`);

      const active = vscode.window.activeTextEditor;
      if (active && this.shouldTrackDocument(active.document) && getCursorHighlightEnabled()) {
        this.postCursorPosition({
          filePath: active.document.uri.fsPath,
          line: active.selection.active.line + 1,
          column: active.selection.active.character + 1
        });
      }
    } catch (error) {
      if (!this.previewPanel || token !== this.renderToken || this.isCanceledError(error) || this.canceledTokens.has(token)) {
        return;
      }

      const message = this.renderErrorMessage(error);
      log(`Render error: token=${token} reason=${reason} message=${message}`);
      this.postStatus("error", message);

      if (reason === "manual" || reason === "open") {
        void vscode.window.showErrorMessage(`LilyPond preview failed: ${message}`);
      }
    } finally {
      this.canceledTokens.delete(token);
    }
  }

  private postUpdate(output: RenderOutput, fileName: string): void {
    if (!this.previewPanel) {
      return;
    }

    void this.previewPanel.webview.postMessage({
      type: "update",
      title: path.basename(fileName),
      pagesHtml: output.pagesHtml,
      pagesCount: output.pagesCount,
      statusText: `Rendered ${output.pagesCount === 1 ? "1 page" : `${output.pagesCount} pages`} in ${output.elapsedMs} ms`,
      command: output.command,
      stderr: output.stderr
    });
  }

  private postStatus(state: "idle" | "updating" | "error", message: string): void {
    if (!this.previewPanel) {
      return;
    }

    void this.previewPanel.webview.postMessage({
      type: "status",
      state,
      message
    });
    log(`Status: ${state} | ${message}`);
  }

  private postCursorPosition(cursor: { filePath: string; line: number; column: number }): void {
    if (!this.previewPanel) {
      return;
    }

    void this.previewPanel.webview.postMessage({
      type: "cursor",
      filePath: cursor.filePath,
      line: cursor.line,
      column: cursor.column,
      autoScroll: getAutoScrollToHighlight()
    });
    log(`Cursor: ${cursor.filePath}:${cursor.line}:${cursor.column}`);
  }

  private postCursorClear(): void {
    if (!this.previewPanel) {
      return;
    }

    void this.previewPanel.webview.postMessage({
      type: "cursorClear"
    });
    log("Cursor highlight cleared.");
  }

  private async revealTargetFromPreview(href: string): Promise<void> {
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
      log(`Preview click navigation failed: href=${href}`);
    }
  }

  private cancelInFlightRender(): void {
    if (!this.inFlightRender) {
      return;
    }

    const current = this.inFlightRender;
    this.canceledTokens.add(current.token);

    try {
      current.process.kill("SIGTERM");
    } catch {
      // Ignore kill errors when process already ended.
    }

    current.killTimer = setTimeout(() => {
      if (!this.inFlightRender || this.inFlightRender.token !== current.token) {
        return;
      }

      try {
        this.inFlightRender.process.kill("SIGKILL");
      } catch {
        // Ignore kill errors when process already ended.
      }
    }, CANCEL_GRACE_MS);
  }

  private clearInFlight(token: number): void {
    if (!this.inFlightRender || this.inFlightRender.token !== token) {
      return;
    }

    if (this.inFlightRender.killTimer) {
      clearTimeout(this.inFlightRender.killTimer);
    }

    this.inFlightRender = undefined;
  }

  private isCanceledError(error: unknown): boolean {
    return error instanceof Error && error.message === "Render canceled.";
  }

  private renderErrorMessage(error: unknown): string {
    const maybeError = error as { code?: string; message?: string };
    if (maybeError?.code === "ENOENT") {
      return "Could not find LilyPond binary. Install LilyPond and/or set lilypond.preview.lilypondPath in VS Code settings.";
    }

    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }
}
