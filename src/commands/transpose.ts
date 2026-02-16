import * as vscode from "vscode";
import { transposeWholeDocument, wrapTranspose } from "../sync/transposition";

const PITCH_EXAMPLES = ["c", "d", "e", "f", "g", "a", "b", "cis", "bes"];

type TransposeMode = "selection" | "document";

export function registerTransposeCommand(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand("lilypond.transpose", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showInformationMessage("Open a LilyPond file to transpose.");
      return;
    }

    const document = editor.document;
    if (!isLilyPondDocument(document)) {
      void vscode.window.showInformationMessage("Transpose is available only for LilyPond documents.");
      return;
    }

    const mode = await pickMode(editor);
    if (!mode) {
      return;
    }

    const fromPitch = await askPitch("Source pitch", "c");
    if (!fromPitch) {
      return;
    }

    const toPitch = await askPitch("Target pitch", "d");
    if (!toPitch) {
      return;
    }

    const edit = new vscode.WorkspaceEdit();
    if (mode === "selection") {
      const selection = editor.selection;
      const selected = document.getText(selection);
      if (!selected.trim()) {
        void vscode.window.showInformationMessage("Select a music fragment before using selection transpose.");
        return;
      }
      const wrapped = wrapTranspose(selected, fromPitch, toPitch);
      edit.replace(document.uri, selection, wrapped);
    } else {
      const fullRange = fullDocumentRange(document);
      const transformed = transposeWholeDocument(document.getText(), fromPitch, toPitch);
      edit.replace(document.uri, fullRange, transformed);
    }

    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      void vscode.window.showErrorMessage("Failed to apply transposition edit.");
      return;
    }

    void vscode.window.showInformationMessage(
      `Applied transpose ${fromPitch} -> ${toPitch} (${mode === "selection" ? "selection" : "document"}).`
    );
  });

  context.subscriptions.push(command);
}

function fullDocumentRange(document: vscode.TextDocument): vscode.Range {
  const endLine = Math.max(0, document.lineCount - 1);
  const endChar = document.lineAt(endLine).text.length;
  return new vscode.Range(0, 0, endLine, endChar);
}

async function pickMode(editor: vscode.TextEditor): Promise<TransposeMode | undefined> {
  const hasSelection = !editor.selection.isEmpty;

  const picked = await vscode.window.showQuickPick(
    [
      {
        label: hasSelection ? "Selection (Recommended)" : "Selection",
        description: "Wrap selected music in \\transpose",
        mode: "selection" as const
      },
      {
        label: "Whole Document",
        description: "Keep \\version/\\include prelude and transpose remaining body",
        mode: "document" as const
      }
    ],
    {
      placeHolder: "Choose transpose scope"
    }
  );

  return picked?.mode;
}

async function askPitch(title: string, example: string): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    title,
    prompt: `Enter LilyPond pitch token (examples: ${PITCH_EXAMPLES.join(", ")})`,
    placeHolder: example,
    value: example,
    validateInput(input) {
      if (!/^[a-g](?:is|es|isis|eses)?[,']*$/.test(input.trim())) {
        return "Use LilyPond pitch token, e.g. c, fis, bes, c', g,,";
      }
      return undefined;
    }
  });

  if (!value) {
    return undefined;
  }

  return value.trim();
}

function isLilyPondDocument(document: vscode.TextDocument): boolean {
  if (document.languageId === "lilypond") {
    return true;
  }

  return /\.(ly|ily|lyi)$/i.test(document.fileName);
}
