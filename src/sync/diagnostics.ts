export type LilypondDiagnosticSeverity = "error" | "warning";

export type LilypondDiagnostic = {
  filePath: string;
  line: number;
  column: number;
  severity: LilypondDiagnosticSeverity;
  message: string;
};

const DIAGNOSTIC_PATTERN = /^(.+?):(\d+):(?:(\d+):)?\s*(warning|error):\s*(.+)$/;

export function parseLilypondDiagnostics(output: string): LilypondDiagnostic[] {
  if (!output.trim()) {
    return [];
  }

  const lines = output.split(/\r?\n/);
  const diagnostics: LilypondDiagnostic[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const match = line.match(DIAGNOSTIC_PATTERN);
    if (!match) {
      continue;
    }

    const filePath = match[1].trim();
    const lineNumber = Number(match[2]);
    const columnNumber = match[3] ? Number(match[3]) : 1;
    const severity = match[4] as LilypondDiagnosticSeverity;
    const message = match[5].trim();

    if (!Number.isFinite(lineNumber) || !Number.isFinite(columnNumber) || !filePath) {
      continue;
    }

    diagnostics.push({
      filePath,
      line: lineNumber,
      column: columnNumber,
      severity,
      message
    });
  }

  return diagnostics;
}
