import * as fs from "fs/promises";
import * as path from "path";

export type IncludeIssue = {
  filePath: string;
  line: number;
  severity: "error" | "warning";
  message: string;
};

export type IncludeEntry = {
  fromFile: string;
  line: number;
  includePath: string;
  resolvedPath: string;
};

export type IncludeGraphResult = {
  files: string[];
  issues: IncludeIssue[];
  entries: IncludeEntry[];
};

export async function analyzeIncludeGraph(rootFilePath: string): Promise<IncludeGraphResult> {
  const visited = new Set<string>();
  const stack: string[] = [];
  const files = new Set<string>();
  const issues: IncludeIssue[] = [];
  const entries: IncludeEntry[] = [];

  async function visit(filePath: string): Promise<void> {
    const normalized = path.resolve(filePath);

    if (stack.includes(normalized)) {
      const cycle = [...stack.slice(stack.indexOf(normalized)), normalized]
        .map((segment) => path.basename(segment))
        .join(" -> ");
      issues.push({
        filePath: normalized,
        line: 1,
        severity: "error",
        message: `Recursive include detected: ${cycle}`
      });
      return;
    }

    if (visited.has(normalized)) {
      return;
    }

    visited.add(normalized);
    files.add(normalized);

    let content = "";
    try {
      content = await fs.readFile(normalized, "utf8");
    } catch {
      issues.push({
        filePath: normalized,
        line: 1,
        severity: "error",
        message: `Cannot read include file: ${normalized}`
      });
      return;
    }

    stack.push(normalized);
    const includes = extractIncludeStatements(content);

    for (const include of includes) {
      const resolved = path.resolve(path.dirname(normalized), include.includePath);
      entries.push({
        fromFile: normalized,
        line: include.line,
        includePath: include.includePath,
        resolvedPath: resolved
      });

      try {
        const stat = await fs.stat(resolved);
        if (!stat.isFile()) {
          issues.push({
            filePath: normalized,
            line: include.line,
            severity: "error",
            message: `Included path is not a file: ${include.includePath}`
          });
          continue;
        }
      } catch {
        issues.push({
          filePath: normalized,
          line: include.line,
          severity: "error",
          message: `Missing include: ${include.includePath}`
        });
        continue;
      }

      if (stack.includes(resolved)) {
        const cycle = [...stack.slice(stack.indexOf(resolved)), resolved]
          .map((segment) => path.basename(segment))
          .join(" -> ");
        issues.push({
          filePath: normalized,
          line: include.line,
          severity: "error",
          message: `Recursive include detected: ${cycle}`
        });
        continue;
      }

      await visit(resolved);
    }

    stack.pop();
  }

  await visit(rootFilePath);

  return {
    files: [...files],
    issues,
    entries
  };
}

export function extractIncludeStatements(content: string): Array<{ line: number; includePath: string }> {
  const lines = content.split(/\r?\n/);
  const result: Array<{ line: number; includePath: string }> = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].replace(/%.*$/, "");
    const match = line.match(/^\s*\\include\s+"([^"]+)"/);
    if (!match) {
      continue;
    }

    result.push({
      line: i + 1,
      includePath: match[1]
    });
  }

  return result;
}
