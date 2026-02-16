import { ChildProcessWithoutNullStreams } from "child_process";
import * as path from "path";
import * as vscode from "vscode";
import {
  getAutoScrollToHighlight,
  getCursorHighlightEnabled,
  getHighlightHysteresisScore,
  getMinRenderIntervalMs,
  getRefreshMode,
  getShowUpdatingBadge,
  getTypingDelayMs,
  type RefreshMode
} from "../config/settings";
import { log } from "../log/logger";
import { collectArtifacts } from "../output/artifacts";
import { CANCEL_GRACE_MS, LilypondRenderer, type RenderOutput } from "../render/LilypondRenderer";
import { analyzeIncludeGraph } from "../sync/includeGraph";
import { parseLilypondDiagnostics } from "../sync/diagnostics";
import { parseTextEditHref } from "../sync/textEdit";
import { getBasePreviewHtml } from "../webview/template";

const PREVIEW_TYPE = "lilypondPreview";
const PREVIEW_TITLE = "LilyPond Preview";

type RenderReason = "open" | "manual" | "typing" | "save" | "editorSwitch" | "selection";

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

export type PreviewDebugState = {
  hasPanel: boolean;
  isPanelVisible: boolean;
  previewDocumentUri?: string;
  status: "idle" | "updating" | "error";
  statusMessage: string;
  pagesCount: number;
  lastCursor?: { filePath: string; line: number; column: number };
  lastPreviewDebugMessage?: string;
  lastReveal?: { href: string; success: boolean };
};

export class PreviewController {
  private readonly context: vscode.ExtensionContext;
  private readonly renderer: LilypondRenderer;
  private readonly diagnosticsCollection: vscode.DiagnosticCollection;
  private readonly includeDiagnosticsCollection: vscode.DiagnosticCollection;
  private readonly statusBarItem: vscode.StatusBarItem;

  private previewPanel: vscode.WebviewPanel | undefined;
  private previewDocumentUri: string | undefined;
  private rootFilePath: string | undefined;
  private includeWatcher: vscode.FileSystemWatcher | undefined;
  private scheduledRender: ScheduledRender | undefined;
  private inFlightRender: InFlightRender | undefined;
  private renderToken = 0;

  private readonly canceledTokens = new Set<number>();
  private readonly lastCompletedVersionByUri = new Map<string, number>();
  private readonly lastRenderStartByUri = new Map<string, number>();
  private debugStatus: "idle" | "updating" | "error" = "idle";
  private debugStatusMessage = "Preview ready.";
  private debugPagesCount = 0;
  private debugLastCursor: { filePath: string; line: number; column: number } | undefined;
  private debugLastPreviewMessage: string | undefined;
  private debugLastReveal: { href: string; success: boolean } | undefined;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.renderer = new LilypondRenderer(context);
    this.diagnosticsCollection = vscode.languages.createDiagnosticCollection("lilypond");
    this.includeDiagnosticsCollection = vscode.languages.createDiagnosticCollection("lilypond-includes");
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.statusBarItem.command = "lilypond.preview";
    this.statusBarItem.text = "$(music) LilyPond: Idle";
    this.statusBarItem.tooltip = "Open LilyPond preview";
    this.statusBarItem.show();
    this.rootFilePath = this.context.workspaceState.get<string>("lilypond.preview.rootFilePath");

    this.context.subscriptions.push(this.diagnosticsCollection, this.includeDiagnosticsCollection, this.statusBarItem);
  }

  async initialize(): Promise<void> {
    await this.renderer.ensureStorageDirectories();
    this.refreshIncludeWatcher();
    this.updateRootStatus();
  }

  register(): void {
    const openPreview = vscode.commands.registerCommand("lilypond.preview", async () => {
      log("Command: lilypond.preview");
      const panel = this.ensurePreviewPanel(true);
      const current = this.getCurrentLilyPondDocument();
      const document = await this.getRenderTargetDocument(current);

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
      const current = this.getPreviewDocument();
      const document = await this.getRenderTargetDocument(current);
      if (!document) {
        void vscode.window.showInformationMessage("No active LilyPond document selected for preview.");
        return;
      }

      this.ensurePreviewPanel(true);
      await this.requestRender(document, "manual", true);
    });

    const renderSelection = vscode.commands.registerCommand("lilypond.preview.renderSelection", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !this.isLilyPondDocument(editor.document)) {
        void vscode.window.showInformationMessage("Open a LilyPond file to render a selection.");
        return;
      }

      const selectedText = editor.document.getText(editor.selection).trim();
      if (!selectedText) {
        void vscode.window.showInformationMessage("Select a LilyPond fragment to render.");
        return;
      }

      const renderText = this.buildPartialRenderText(selectedText);
      this.ensurePreviewPanel(true);
      this.previewDocumentUri = editor.document.uri.toString();
      await this.startRender(editor.document, "selection", renderText, "Partial");
    });

    const exportPdf = vscode.commands.registerCommand("lilypond.export.pdf", async () => {
      const current = this.getPreviewDocument() ?? this.getCurrentLilyPondDocument();
      const document = await this.getRenderTargetDocument(current);
      if (!document) {
        void vscode.window.showInformationMessage("Open a LilyPond file to export PDF.");
        return;
      }

      try {
        this.postStatus("updating", `Exporting PDF for ${path.basename(document.fileName)}...`);
        const pdfPath = await this.renderer.exportPdf(document);
        this.postStatus("idle", `PDF exported: ${path.basename(pdfPath)}`);
        await vscode.env.openExternal(vscode.Uri.file(pdfPath));
      } catch (error) {
        const message = this.renderErrorMessage(error);
        this.postStatus("error", message);
        void vscode.window.showErrorMessage(`LilyPond PDF export failed: ${message}`);
      }
    });

    const exportMidi = vscode.commands.registerCommand("lilypond.export.midi", async () => {
      const current = this.getPreviewDocument() ?? this.getCurrentLilyPondDocument();
      const document = await this.getRenderTargetDocument(current);
      if (!document) {
        void vscode.window.showInformationMessage("Open a LilyPond file to export MIDI.");
        return;
      }

      try {
        this.postStatus("updating", `Exporting MIDI for ${path.basename(document.fileName)}...`);
        const midiPath = await this.renderer.exportMidi(document);
        this.postStatus("idle", `MIDI exported: ${path.basename(midiPath)}`);
        await vscode.env.openExternal(vscode.Uri.file(midiPath));
      } catch (error) {
        const message = this.renderErrorMessage(error);
        this.postStatus("error", message);
        void vscode.window.showErrorMessage(
          `LilyPond MIDI export failed: ${message}. Ensure your score has a \\\\midi block.`
        );
      }
    });

    const openLatestArtifacts = vscode.commands.registerCommand("lilypond.output.openLatest", async () => {
      const current = this.getPreviewDocument() ?? this.getCurrentLilyPondDocument();
      const document = await this.getRenderTargetDocument(current);
      if (!document) {
        void vscode.window.showInformationMessage("Open a LilyPond file to browse output artifacts.");
        return;
      }

      const artifacts = await collectArtifacts(document.fileName);
      if (artifacts.length === 0) {
        void vscode.window.showInformationMessage("No output artifacts found for this score yet.");
        return;
      }

      const picked = await vscode.window.showQuickPick(
        artifacts.map((artifact) => ({
          label: path.basename(artifact.path),
          description: artifact.type,
          detail: artifact.path
        })),
        { placeHolder: "Select artifact to open" }
      );

      if (!picked?.detail) {
        return;
      }

      await vscode.env.openExternal(vscode.Uri.file(picked.detail));
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

    const setRootFile = vscode.commands.registerCommand("lilypond.root.set", async () => {
      const active = vscode.window.activeTextEditor?.document;
      if (!active || !this.isLilyPondDocument(active)) {
        void vscode.window.showInformationMessage("Open a LilyPond file and run this command again.");
        return;
      }

      this.rootFilePath = active.fileName;
      await this.context.workspaceState.update("lilypond.preview.rootFilePath", this.rootFilePath);
      this.refreshIncludeWatcher();
      this.updateRootStatus();
      void vscode.window.showInformationMessage(`LilyPond root file set: ${path.basename(this.rootFilePath)}`);

      if (this.previewPanel) {
        this.previewDocumentUri = active.uri.toString();
        await this.requestRender(active, "manual", true);
      }
    });

    const clearRootFile = vscode.commands.registerCommand("lilypond.root.clear", async () => {
      this.rootFilePath = undefined;
      await this.context.workspaceState.update("lilypond.preview.rootFilePath", undefined);
      this.disposeIncludeWatcher();
      this.updateRootStatus();
      void vscode.window.showInformationMessage("LilyPond root file cleared.");
    });

    const nextDiagnostic = vscode.commands.registerCommand("lilypond.diagnostic.next", async () => {
      await this.navigateDiagnostic(1);
    });

    const previousDiagnostic = vscode.commands.registerCommand("lilypond.diagnostic.previous", async () => {
      await this.navigateDiagnostic(-1);
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
      renderSelection,
      exportPdf,
      exportMidi,
      openLatestArtifacts,
      toggleAutoRefresh,
      setRootFile,
      clearRootFile,
      nextDiagnostic,
      previousDiagnostic,
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
    this.disposeIncludeWatcher();
  }

  getDebugState(): PreviewDebugState {
    return {
      hasPanel: Boolean(this.previewPanel),
      isPanelVisible: Boolean(this.previewPanel?.visible),
      previewDocumentUri: this.previewDocumentUri,
      status: this.debugStatus,
      statusMessage: this.debugStatusMessage,
      pagesCount: this.debugPagesCount,
      lastCursor: this.debugLastCursor,
      lastPreviewDebugMessage: this.debugLastPreviewMessage,
      lastReveal: this.debugLastReveal
    };
  }

  async debugRevealTargetFromPreview(href: string): Promise<void> {
    await this.revealTargetFromPreview(href);
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
        this.debugLastPreviewMessage = payload.message;
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
    if (this.rootFilePath) {
      const openRoot = vscode.workspace.textDocuments.find((document) => document.fileName === this.rootFilePath);
      if (openRoot && this.isLilyPondDocument(openRoot)) {
        return openRoot;
      }
    }

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

  private async getRenderTargetDocument(baseDocument: vscode.TextDocument | undefined): Promise<vscode.TextDocument | undefined> {
    if (this.rootFilePath) {
      try {
        const rootUri = vscode.Uri.file(this.rootFilePath);
        const rootDocument = await vscode.workspace.openTextDocument(rootUri);
        return this.isLilyPondDocument(rootDocument) ? rootDocument : baseDocument;
      } catch {
        void vscode.window.showWarningMessage("Configured LilyPond root file could not be opened. Falling back to current file.");
      }
    }

    return baseDocument;
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

  private async startRender(
    document: vscode.TextDocument,
    reason: RenderReason,
    contentOverride?: string,
    statusPrefix?: string
  ): Promise<void> {
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
      const onSpawn = ({
        process,
        uri: renderUri,
        version,
        token: renderToken
      }: {
        process: ChildProcessWithoutNullStreams;
        uri: string;
        version: number;
        token: number;
      }): void => {
        this.inFlightRender = {
          token: renderToken,
          uri: renderUri,
          version,
          process
        };
      };

      const onClear = (clearedToken: number): void => {
        this.clearInFlight(clearedToken);
      };

      const output = contentOverride
        ? await this.renderer.renderContent(document, contentOverride, token, onSpawn, onClear)
        : await this.renderer.renderDocument(document, token, onSpawn, onClear);

      if (!this.previewPanel || token !== this.renderToken || this.canceledTokens.has(token)) {
        return;
      }

      this.lastCompletedVersionByUri.set(uri, document.version);
      this.postUpdate(output, document.fileName, statusPrefix);
      this.applyDiagnosticsFromOutput(document.uri, output.stderr);
      await this.applyIncludeDiagnostics(document.fileName);
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
      this.applyDiagnosticsFromOutput(document.uri, message);
      this.postStatus("error", message);

      if (reason === "manual" || reason === "open") {
        void vscode.window.showErrorMessage(`LilyPond preview failed: ${message}`);
      }
    } finally {
      this.canceledTokens.delete(token);
    }
  }

  private postUpdate(output: RenderOutput, fileName: string, statusPrefix?: string): void {
    if (!this.previewPanel) {
      return;
    }

    void this.previewPanel.webview.postMessage({
      type: "update",
      title: path.basename(fileName),
      pagesHtml: output.pagesHtml,
      pagesCount: output.pagesCount,
      statusText: `${statusPrefix ? `${statusPrefix}: ` : ""}Rendered ${output.pagesCount === 1 ? "1 page" : `${output.pagesCount} pages`} in ${output.elapsedMs} ms`,
      command: output.command,
      stderr: output.stderr
    });
    this.debugStatus = "idle";
    this.debugStatusMessage = `${statusPrefix ? `${statusPrefix}: ` : ""}Rendered ${output.pagesCount === 1 ? "1 page" : `${output.pagesCount} pages`} in ${output.elapsedMs} ms`;
    this.debugPagesCount = output.pagesCount;

    this.updateStatusBar("idle", `Rendered in ${output.elapsedMs} ms`);
  }

  private buildPartialRenderText(selectedText: string): string {
    const hasTopLevelBlock = /\\score\\s*\\{|\\relative\\s+[a-g][,']*\\s*\\{|\\new\\s+\\w+/m.test(selectedText);
    if (hasTopLevelBlock) {
      return selectedText;
    }

    return `\\\\relative c' {\\n${selectedText}\\n}`;
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
    this.debugStatus = state;
    this.debugStatusMessage = message;
    log(`Status: ${state} | ${message}`);
    this.updateStatusBar(state, message);
  }

  private updateStatusBar(state: "idle" | "updating" | "error", message: string): void {
    const icon = state === "updating" ? "$(sync~spin)" : state === "error" ? "$(error)" : "$(music)";
    const label = state === "updating" ? "Rendering" : state === "error" ? "Error" : "Idle";
    const rootLabel = this.rootFilePath ? ` [root: ${path.basename(this.rootFilePath)}]` : "";
    this.statusBarItem.text = `${icon} LilyPond: ${label}${rootLabel}`;
    this.statusBarItem.tooltip = message;
  }

  private updateRootStatus(): void {
    this.updateStatusBar("idle", this.rootFilePath ? `Root file: ${this.rootFilePath}` : "Root file disabled");
  }

  private refreshIncludeWatcher(): void {
    this.disposeIncludeWatcher();
    if (!this.rootFilePath) {
      return;
    }

    const rootDir = path.dirname(this.rootFilePath);
    const pattern = new vscode.RelativePattern(rootDir, "**/*.{ly,ily,lyi}");
    this.includeWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    const onChange = (uri: vscode.Uri): void => {
      void this.handleRootRelatedFileChange(uri);
    };

    this.includeWatcher.onDidChange(onChange);
    this.includeWatcher.onDidCreate(onChange);
    this.includeWatcher.onDidDelete(onChange);
    this.context.subscriptions.push(this.includeWatcher);
  }

  private disposeIncludeWatcher(): void {
    if (!this.includeWatcher) {
      return;
    }

    this.includeWatcher.dispose();
    this.includeWatcher = undefined;
  }

  private async handleRootRelatedFileChange(_uri: vscode.Uri): Promise<void> {
    if (!this.previewPanel || !this.rootFilePath) {
      return;
    }

    try {
      const rootDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(this.rootFilePath));
      if (this.isLilyPondDocument(rootDocument)) {
        this.previewDocumentUri = rootDocument.uri.toString();
        await this.requestRender(rootDocument, "save");
      }
    } catch {
      // Ignore missing/invalid root file changes.
    }
  }

  private applyDiagnosticsFromOutput(fallbackUri: vscode.Uri, output: string): void {
    const parsed = parseLilypondDiagnostics(output);
    const grouped = new Map<string, { uri: vscode.Uri; diagnostics: vscode.Diagnostic[] }>();

    for (const entry of parsed) {
      const uri = this.resolveDiagnosticUri(entry.filePath, fallbackUri);
      const key = uri.toString();
      const bucket = grouped.get(key) ?? { uri, diagnostics: [] };
      const line = Math.max(0, entry.line - 1);
      const column = Math.max(0, entry.column - 1);
      const range = new vscode.Range(line, column, line, column + 1);
      const diagnostic = new vscode.Diagnostic(
        range,
        entry.message,
        entry.severity === "error" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
      );
      diagnostic.source = "lilypond";
      bucket.diagnostics.push(diagnostic);
      grouped.set(key, bucket);
    }

    this.diagnosticsCollection.clear();
    for (const bucket of grouped.values()) {
      this.diagnosticsCollection.set(bucket.uri, bucket.diagnostics);
    }
  }

  private async applyIncludeDiagnostics(rootFilePath: string): Promise<void> {
    const graph = await analyzeIncludeGraph(rootFilePath);
    const grouped = new Map<string, { uri: vscode.Uri; diagnostics: vscode.Diagnostic[] }>();

    for (const issue of graph.issues) {
      const uri = vscode.Uri.file(issue.filePath);
      const key = uri.toString();
      const bucket = grouped.get(key) ?? { uri, diagnostics: [] };
      const line = Math.max(0, issue.line - 1);
      const range = new vscode.Range(line, 0, line, 1);
      const diagnostic = new vscode.Diagnostic(
        range,
        issue.message,
        issue.severity === "error" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
      );
      diagnostic.source = "lilypond-include";
      bucket.diagnostics.push(diagnostic);
      grouped.set(key, bucket);
    }

    this.includeDiagnosticsCollection.clear();
    for (const bucket of grouped.values()) {
      this.includeDiagnosticsCollection.set(bucket.uri, bucket.diagnostics);
    }
  }

  private resolveDiagnosticUri(filePath: string, fallbackUri: vscode.Uri): vscode.Uri {
    if (path.isAbsolute(filePath)) {
      return vscode.Uri.file(filePath);
    }

    return vscode.Uri.file(path.resolve(path.dirname(fallbackUri.fsPath), filePath));
  }

  private async navigateDiagnostic(direction: 1 | -1): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showInformationMessage("Open a LilyPond file to navigate diagnostics.");
      return;
    }

    const diagnostics = [...(this.diagnosticsCollection.get(editor.document.uri) ?? [])].sort((a, b) => {
      const lineDiff = a.range.start.line - b.range.start.line;
      if (lineDiff !== 0) {
        return lineDiff;
      }
      return a.range.start.character - b.range.start.character;
    });

    if (diagnostics.length === 0) {
      void vscode.window.showInformationMessage("No LilyPond diagnostics for this file.");
      return;
    }

    const current = editor.selection.active;
    const target = direction === 1 ? this.findNextDiagnostic(diagnostics, current) : this.findPreviousDiagnostic(diagnostics, current);

    const selection = new vscode.Selection(target.range.start, target.range.end);
    editor.selection = selection;
    editor.revealRange(target.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  private findNextDiagnostic(diagnostics: vscode.Diagnostic[], current: vscode.Position): vscode.Diagnostic {
    for (const diagnostic of diagnostics) {
      if (
        diagnostic.range.start.line > current.line ||
        (diagnostic.range.start.line === current.line && diagnostic.range.start.character > current.character)
      ) {
        return diagnostic;
      }
    }

    return diagnostics[0];
  }

  private findPreviousDiagnostic(diagnostics: vscode.Diagnostic[], current: vscode.Position): vscode.Diagnostic {
    for (let index = diagnostics.length - 1; index >= 0; index -= 1) {
      const diagnostic = diagnostics[index];
      if (
        diagnostic.range.start.line < current.line ||
        (diagnostic.range.start.line === current.line && diagnostic.range.start.character < current.character)
      ) {
        return diagnostic;
      }
    }

    return diagnostics[diagnostics.length - 1];
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
      autoScroll: getAutoScrollToHighlight(),
      hysteresisScore: getHighlightHysteresisScore()
    });
    this.debugLastCursor = cursor;
    log(`Cursor: ${cursor.filePath}:${cursor.line}:${cursor.column}`);
  }

  private postCursorClear(): void {
    if (!this.previewPanel) {
      return;
    }

    void this.previewPanel.webview.postMessage({
      type: "cursorClear"
    });
    this.debugLastCursor = undefined;
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
      this.debugLastReveal = { href, success: true };
    } catch {
      this.debugLastReveal = { href, success: false };
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
