import * as path from "path";

export type TextEditTarget = {
  filePath: string;
  line: number;
  column: number;
  endColumn?: number;
};

export function parseTextEditHref(href: string): TextEditTarget | undefined {
  if (!href.startsWith("textedit://")) {
    return undefined;
  }

  const withoutScheme = decodeURIComponent(href.slice("textedit://".length));
  const segments = withoutScheme.split(":");
  if (segments.length < 3) {
    return undefined;
  }

  const last = segments[segments.length - 1];
  const secondLast = segments[segments.length - 2];
  const thirdLast = segments[segments.length - 3];

  if (!/^\d+$/.test(last) || !/^\d+$/.test(secondLast)) {
    return undefined;
  }

  const hasEndColumn = /^\d+$/.test(thirdLast);
  const filePath = segments.slice(0, hasEndColumn ? -3 : -2).join(":");
  const line = Number(hasEndColumn ? thirdLast : secondLast);
  const column = Number(hasEndColumn ? secondLast : last);
  const endColumn = hasEndColumn ? Number(last) : undefined;

  if (!Number.isFinite(line) || !Number.isFinite(column)) {
    return undefined;
  }

  return {
    filePath,
    line,
    column,
    endColumn
  };
}

export function normalizeFsPath(filePath: string): string {
  return path.normalize(filePath).toLowerCase();
}

export function rewriteTexteditTargets(svg: string, originalPath: string, sourcePath: string): string {
  const normalizedOriginal = normalizeFsPath(originalPath);
  const escapedSource = encodeURI(sourcePath);

  return svg.replace(/textedit:\/\/[^\"]+/g, (value) => {
    const parsed = parseTextEditHref(value);
    if (!parsed) {
      return value;
    }

    if (normalizeFsPath(parsed.filePath) !== normalizedOriginal) {
      return value;
    }

    const endPart = typeof parsed.endColumn === "number" ? `:${parsed.endColumn}` : "";
    return `textedit://${escapedSource}:${parsed.line}:${parsed.column}${endPart}`;
  });
}
