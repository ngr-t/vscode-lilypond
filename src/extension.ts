import * as vscode from "vscode";
import { registerTransposeCommand } from "./commands/transpose";
import { initLogger, log } from "./log/logger";
import { registerLanguageProviders } from "./language/providers";
import { registerStructureFeatures } from "./language/structure";
import { registerArtifactsView } from "./output/ArtifactsViewProvider";
import { PreviewController, type PreviewDebugState } from "./preview/PreviewController";

let controller: PreviewController | undefined;

export type LilypondExtensionApi = {
  getPreviewDebugState: () => PreviewDebugState | undefined;
  waitForPreview: (predicate: (state: PreviewDebugState) => boolean, timeoutMs?: number) => Promise<PreviewDebugState>;
  simulatePreviewClick: (href: string) => Promise<void>;
};

export async function activate(context: vscode.ExtensionContext): Promise<LilypondExtensionApi> {
  initLogger(context);
  log("Extension activated.");

  registerLanguageProviders(context);
  registerStructureFeatures(context);
  registerTransposeCommand(context);
  registerArtifactsView(context);

  controller = new PreviewController(context);
  await controller.initialize();
  controller.register();

  return {
    getPreviewDebugState: () => controller?.getDebugState(),
    waitForPreview: async (predicate: (state: PreviewDebugState) => boolean, timeoutMs = 10000): Promise<PreviewDebugState> => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const state = controller?.getDebugState();
        if (state && predicate(state)) {
          return state;
        }

        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      throw new Error(`Timed out waiting for preview state after ${timeoutMs}ms.`);
    },
    simulatePreviewClick: async (href: string): Promise<void> => {
      if (!controller) {
        throw new Error("Preview controller is not initialized.");
      }
      await controller.debugRevealTargetFromPreview(href);
    }
  };
}

export function deactivate(): void {
  controller?.deactivate();
  controller = undefined;
}
