import * as vscode from "vscode";
import { registerTransposeCommand } from "./commands/transpose";
import { initLogger, log } from "./log/logger";
import { registerLanguageProviders } from "./language/providers";
import { registerStructureFeatures } from "./language/structure";
import { PreviewController } from "./preview/PreviewController";

let controller: PreviewController | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  initLogger(context);
  log("Extension activated.");

  registerLanguageProviders(context);
  registerStructureFeatures(context);
  registerTransposeCommand(context);

  controller = new PreviewController(context);
  await controller.initialize();
  controller.register();
}

export function deactivate(): void {
  controller?.deactivate();
  controller = undefined;
}
