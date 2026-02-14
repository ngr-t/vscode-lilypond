import * as vscode from "vscode";

export const DEFAULT_RENDER_DELAY_MS = 600;
export const DEFAULT_MIN_INTERVAL_MS = 1200;
export const DEFAULT_REFRESH_MODE: RefreshMode = "idleAndSave";

export type RefreshMode = "idleAndSave" | "saveOnly" | "manual" | "live";

export function getRefreshMode(config?: vscode.WorkspaceConfiguration): RefreshMode {
  const resolved = (config ?? vscode.workspace.getConfiguration("lilypond.preview")).get<string>(
    "refreshMode",
    DEFAULT_REFRESH_MODE
  );

  if (resolved === "saveOnly" || resolved === "manual" || resolved === "live" || resolved === "idleAndSave") {
    return resolved;
  }

  return DEFAULT_REFRESH_MODE;
}

export function getTypingDelayMs(mode: RefreshMode): number {
  const config = vscode.workspace.getConfiguration("lilypond.preview");
  const configuredDelay = config.get<number>("renderDelayMs", DEFAULT_RENDER_DELAY_MS);
  const baseline = Number.isFinite(configuredDelay) ? Math.max(100, configuredDelay) : DEFAULT_RENDER_DELAY_MS;

  if (mode === "live") {
    return Math.max(120, Math.min(350, baseline));
  }

  return baseline;
}

export function getMinRenderIntervalMs(): number {
  const config = vscode.workspace.getConfiguration("lilypond.preview");
  const configured = config.get<number>("minRenderIntervalMs", DEFAULT_MIN_INTERVAL_MS);
  return Number.isFinite(configured) ? Math.max(100, configured) : DEFAULT_MIN_INTERVAL_MS;
}

export function getShowUpdatingBadge(): boolean {
  const config = vscode.workspace.getConfiguration("lilypond.preview");
  return config.get<boolean>("showUpdatingBadge", true);
}

export function getCursorHighlightEnabled(): boolean {
  const config = vscode.workspace.getConfiguration("lilypond.preview");
  return config.get<boolean>("cursorHighlightEnabled", true);
}

export function getAutoScrollToHighlight(): boolean {
  const config = vscode.workspace.getConfiguration("lilypond.preview");
  return config.get<boolean>("autoScrollToHighlight", true);
}

export function getLilypondBinaryPath(): string {
  const config = vscode.workspace.getConfiguration("lilypond.preview");
  return config.get<string>("lilypondPath")?.trim() || "lilypond";
}
