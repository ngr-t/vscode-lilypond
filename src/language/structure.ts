import * as vscode from "vscode";
import { parseStructureNodes } from "../sync/structure";

function getSelector(): vscode.DocumentSelector {
  return [
    { language: "lilypond" },
    { pattern: "**/*.ly" },
    { pattern: "**/*.ily" },
    { pattern: "**/*.lyi" }
  ];
}

export function registerStructureFeatures(context: vscode.ExtensionContext): void {
  const symbolProvider = vscode.languages.registerDocumentSymbolProvider(getSelector(), {
    provideDocumentSymbols(document) {
      const nodes = parseStructureNodes(document.getText());
      return nodes.map((node) => {
        const range = new vscode.Range(node.startLine, 0, node.endLine, document.lineAt(node.endLine).text.length);
        const symbol = new vscode.DocumentSymbol(
          node.label,
          node.kind === "assignment" ? "Assignment" : "Block",
          node.kind === "assignment" ? vscode.SymbolKind.Variable : vscode.SymbolKind.Module,
          range,
          new vscode.Range(node.startLine, 0, node.startLine, document.lineAt(node.startLine).text.length)
        );
        return symbol;
      });
    }
  });

  const nextBlock = vscode.commands.registerCommand("lilypond.navigate.nextBlock", async () => {
    await navigateToBlock(1);
  });

  const previousBlock = vscode.commands.registerCommand("lilypond.navigate.previousBlock", async () => {
    await navigateToBlock(-1);
  });

  context.subscriptions.push(symbolProvider, nextBlock, previousBlock);
}

async function navigateToBlock(direction: 1 | -1): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const nodes = parseStructureNodes(editor.document.getText()).sort((a, b) => a.startLine - b.startLine);
  if (nodes.length === 0) {
    void vscode.window.showInformationMessage("No LilyPond blocks detected in this file.");
    return;
  }

  const line = editor.selection.active.line;
  const target = direction === 1 ? findNext(nodes, line) : findPrevious(nodes, line);
  const position = new vscode.Position(target.startLine, 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

function findNext(nodes: Array<{ startLine: number }>, line: number): { startLine: number } {
  for (const node of nodes) {
    if (node.startLine > line) {
      return node;
    }
  }
  return nodes[0];
}

function findPrevious(nodes: Array<{ startLine: number }>, line: number): { startLine: number } {
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    if (nodes[i].startLine < line) {
      return nodes[i];
    }
  }
  return nodes[nodes.length - 1];
}
