import * as vscode from "vscode";
import { KEYWORD_BY_LABEL, LILYPOND_KEYWORDS } from "./lilypondData";

function getLilypondLanguageSelector(): vscode.DocumentSelector {
  return [
    { language: "lilypond" },
    { pattern: "**/*.ly" },
    { pattern: "**/*.ily" },
    { pattern: "**/*.lyi" }
  ];
}

export function registerLanguageProviders(context: vscode.ExtensionContext): void {
  const completionProvider = vscode.languages.registerCompletionItemProvider(
    getLilypondLanguageSelector(),
    {
      provideCompletionItems(document, position) {
        const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
        const commandMatch = linePrefix.match(/\\[A-Za-z-]*$/);
        if (!commandMatch) {
          return [];
        }

        return LILYPOND_KEYWORDS.map((keyword) => {
          const item = new vscode.CompletionItem(keyword.label, vscode.CompletionItemKind.Keyword);
          item.detail = keyword.detail;
          item.documentation = new vscode.MarkdownString(keyword.documentation);
          item.insertText = keyword.label;
          return item;
        });
      }
    },
    "\\"
  );

  const hoverProvider = vscode.languages.registerHoverProvider(getLilypondLanguageSelector(), {
    provideHover(document, position) {
      const lineText = document.lineAt(position.line).text;
      const wordRange = document.getWordRangeAtPosition(position, /\\[A-Za-z-]+/);
      if (!wordRange) {
        return undefined;
      }

      const token = lineText.slice(wordRange.start.character, wordRange.end.character);
      const keyword = KEYWORD_BY_LABEL.get(token);
      if (!keyword) {
        return undefined;
      }

      const markdown = new vscode.MarkdownString();
      markdown.appendMarkdown(`**${keyword.label}**  \n`);
      markdown.appendMarkdown(`${keyword.detail}  \n\n`);
      markdown.appendMarkdown(keyword.documentation);
      markdown.isTrusted = false;
      return new vscode.Hover(markdown, wordRange);
    }
  });

  const codeActionProvider = vscode.languages.registerCodeActionsProvider(getLilypondLanguageSelector(), {
    provideCodeActions(document, _range, codeActionContext) {
      const actions: vscode.CodeAction[] = [];
      const lilyDiagnostics = codeActionContext.diagnostics.filter((d) => d.source === "lilypond");

      for (const diagnostic of lilyDiagnostics) {
        const message = diagnostic.message.toLowerCase();

        if (message.includes("no \\version statement found")) {
          if (!/^\\s*\\\\version\\s+\"[^\"]+\"/m.test(document.getText())) {
            const fix = new vscode.CodeAction("Add \\version statement", vscode.CodeActionKind.QuickFix);
            fix.diagnostics = [diagnostic];
            const edit = new vscode.WorkspaceEdit();
            edit.insert(document.uri, new vscode.Position(0, 0), "\\version \"2.24.4\"\\n\\n");
            fix.edit = edit;
            actions.push(fix);
          }
          continue;
        }

        if (message.includes("unknown escaped string")) {
          const lineText = document.lineAt(diagnostic.range.start.line).text;
          const startChar = diagnostic.range.start.character;
          if (startChar > 0 && lineText[startChar - 1] === "\\") {
            const replaceStart = Math.max(0, startChar - 1);
            const replaceEnd = Math.min(lineText.length, startChar + 1);
            const segment = lineText.slice(replaceStart, replaceEnd);
            if (segment.startsWith("\\\\")) {
              const fix = new vscode.CodeAction("Replace \\\\ with \\", vscode.CodeActionKind.QuickFix);
              fix.diagnostics = [diagnostic];
              const edit = new vscode.WorkspaceEdit();
              edit.replace(
                document.uri,
                new vscode.Range(diagnostic.range.start.line, replaceStart, diagnostic.range.start.line, replaceEnd),
                segment.replace("\\\\", "\\")
              );
              fix.edit = edit;
              actions.push(fix);
            }
          }
          continue;
        }

        if (message.includes("unexpected end of input") || message.includes("end of file")) {
          const fix = new vscode.CodeAction("Append closing brace at end of file", vscode.CodeActionKind.QuickFix);
          fix.diagnostics = [diagnostic];
          const edit = new vscode.WorkspaceEdit();
          const lastLine = Math.max(0, document.lineCount - 1);
          const endPos = new vscode.Position(lastLine, document.lineAt(lastLine).text.length);
          edit.insert(document.uri, endPos, "\n}");
          fix.edit = edit;
          actions.push(fix);
        }
      }

      return actions;
    }
  });

  context.subscriptions.push(completionProvider, hoverProvider, codeActionProvider);
}
