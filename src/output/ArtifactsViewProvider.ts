import * as path from "path";
import * as vscode from "vscode";
import { collectArtifacts } from "./artifacts";

export function registerArtifactsView(context: vscode.ExtensionContext): void {
  const provider = new ArtifactsTreeDataProvider();
  const tree = vscode.window.createTreeView("lilypondArtifacts", { treeDataProvider: provider });

  const refresh = vscode.commands.registerCommand("lilypond.output.refreshArtifacts", () => {
    void provider.refresh();
  });

  const open = vscode.commands.registerCommand("lilypond.output.openArtifact", async (uri: vscode.Uri) => {
    await vscode.env.openExternal(uri);
  });

  const onEditor = vscode.window.onDidChangeActiveTextEditor(() => {
    void provider.refresh();
  });

  const onSave = vscode.workspace.onDidSaveTextDocument(() => {
    void provider.refresh();
  });

  context.subscriptions.push(tree, refresh, open, onEditor, onSave);
}

class ArtifactsTreeDataProvider implements vscode.TreeDataProvider<ArtifactTreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<ArtifactTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  async refresh(): Promise<void> {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: ArtifactTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<ArtifactTreeItem[]> {
    const scoreFilePath = this.getActiveScoreFilePath();
    if (!scoreFilePath) {
      return [new ArtifactTreeItem("Open a LilyPond file to browse artifacts.", vscode.TreeItemCollapsibleState.None)];
    }

    const artifacts = await collectArtifacts(scoreFilePath);
    if (artifacts.length === 0) {
      return [new ArtifactTreeItem("No artifacts yet for current score.", vscode.TreeItemCollapsibleState.None)];
    }

    return artifacts.map(
      (artifact) =>
        new ArtifactTreeItem(path.basename(artifact.path), vscode.TreeItemCollapsibleState.None, {
          tooltip: artifact.path,
          description: artifact.type,
          command: {
            command: "lilypond.output.openArtifact",
            title: "Open Artifact",
            arguments: [vscode.Uri.file(artifact.path)]
          },
          contextValue: "artifact"
        })
    );
  }

  private getActiveScoreFilePath(): string | undefined {
    const active = vscode.window.activeTextEditor?.document;
    if (!active) {
      return undefined;
    }

    if (active.languageId === "lilypond") {
      return active.fileName;
    }

    const extension = path.extname(active.fileName).toLowerCase();
    if (extension === ".ly" || extension === ".ily" || extension === ".lyi") {
      return active.fileName;
    }

    return undefined;
  }
}

class ArtifactTreeItem extends vscode.TreeItem {
  constructor(label: string, collapsibleState: vscode.TreeItemCollapsibleState, options?: Partial<vscode.TreeItem>) {
    super(label, collapsibleState);
    if (!options) {
      return;
    }

    this.tooltip = options.tooltip;
    this.description = options.description;
    this.command = options.command;
    this.contextValue = options.contextValue;
  }
}
