import * as vscode from "vscode";
import { initLogger, log } from "./log/logger";
import { PreviewController } from "./preview/PreviewController";

let controller: PreviewController | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  initLogger(context);
  log("Extension activated.");

  controller = new PreviewController(context);
  await controller.initialize();
  controller.register();
}

export function deactivate(): void {
  controller?.deactivate();
  controller = undefined;
}
