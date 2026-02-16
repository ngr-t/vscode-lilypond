export function wrapTranspose(content: string, fromPitch: string, toPitch: string): string {
  const inner = content.replace(/^\n+|\n+$/g, "");
  return `\\transpose ${fromPitch} ${toPitch} {\n${indentBlock(inner)}\n}`;
}

export function transposeWholeDocument(content: string, fromPitch: string, toPitch: string): string {
  const scoreWrapped = wrapTopLevelScoreBlocks(content, fromPitch, toPitch);
  if (typeof scoreWrapped === "string") {
    return ensureTrailingNewline(scoreWrapped, content);
  }

  const lines = content.split(/\r?\n/);
  let bodyStart = 0;

  while (bodyStart < lines.length) {
    const line = lines[bodyStart];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("%") || /^\\(version|include)\b/.test(trimmed)) {
      bodyStart += 1;
      continue;
    }
    break;
  }

  const prelude = lines.slice(0, bodyStart).join("\n").trimEnd();
  const body = lines.slice(bodyStart).join("\n").trim();

  if (!body) {
    return content;
  }

  const wrappedBody = wrapTranspose(body, fromPitch, toPitch);
  if (!prelude) {
    return `${wrappedBody}\n`;
  }

  return `${prelude}\n\n${wrappedBody}\n`;
}

function wrapTopLevelScoreBlocks(content: string, fromPitch: string, toPitch: string): string | undefined {
  const scoreBlocks = findTopLevelCommandBlocks(content, "score");
  if (scoreBlocks.length === 0) {
    return undefined;
  }

  let output = content;
  let changed = false;

  for (let index = scoreBlocks.length - 1; index >= 0; index -= 1) {
    const block = scoreBlocks[index];
    const inner = output.slice(block.openBraceIndex + 1, block.closeBraceIndex);
    if (isAlreadyTransposed(inner)) {
      continue;
    }

    const wrappedInner = `\n${indentBlock(wrapTranspose(inner, fromPitch, toPitch))}\n`;
    output = `${output.slice(0, block.openBraceIndex + 1)}${wrappedInner}${output.slice(block.closeBraceIndex)}`;
    changed = true;
  }

  return changed ? output : content;
}

function findTopLevelCommandBlocks(
  content: string,
  command: string
): Array<{ openBraceIndex: number; closeBraceIndex: number }> {
  const blocks: Array<{ openBraceIndex: number; closeBraceIndex: number }> = [];
  let depth = 0;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];

    if (char === "%") {
      index = skipToLineEnd(content, index);
      continue;
    }

    if (char === "\"") {
      index = skipString(content, index);
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (char !== "\\" || depth !== 0) {
      continue;
    }

    const parsedCommand = parseCommand(content, index);
    if (!parsedCommand) {
      continue;
    }

    if (parsedCommand.command !== command) {
      index = parsedCommand.endIndex - 1;
      continue;
    }

    const braceIndex = skipTrivia(content, parsedCommand.endIndex);
    if (braceIndex >= content.length || content[braceIndex] !== "{") {
      index = parsedCommand.endIndex - 1;
      continue;
    }

    const closeBraceIndex = findMatchingBrace(content, braceIndex);
    if (closeBraceIndex < 0) {
      index = parsedCommand.endIndex - 1;
      continue;
    }

    blocks.push({ openBraceIndex: braceIndex, closeBraceIndex });
    index = closeBraceIndex;
  }

  return blocks;
}

function parseCommand(content: string, index: number): { command: string; endIndex: number } | undefined {
  if (content[index] !== "\\") {
    return undefined;
  }

  let cursor = index + 1;
  while (cursor < content.length && /[A-Za-z-]/.test(content[cursor])) {
    cursor += 1;
  }

  if (cursor === index + 1) {
    return undefined;
  }

  return {
    command: content.slice(index + 1, cursor),
    endIndex: cursor
  };
}

function skipTrivia(content: string, startIndex: number): number {
  let cursor = startIndex;
  while (cursor < content.length) {
    const char = content[cursor];
    if (/\s/.test(char)) {
      cursor += 1;
      continue;
    }

    if (char === "%") {
      cursor = skipToLineEnd(content, cursor) + 1;
      continue;
    }

    return cursor;
  }

  return cursor;
}

function findMatchingBrace(content: string, openBraceIndex: number): number {
  let depth = 1;

  for (let index = openBraceIndex + 1; index < content.length; index += 1) {
    const char = content[index];

    if (char === "%") {
      index = skipToLineEnd(content, index);
      continue;
    }

    if (char === "\"") {
      index = skipString(content, index);
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function skipString(content: string, startQuoteIndex: number): number {
  for (let index = startQuoteIndex + 1; index < content.length; index += 1) {
    const char = content[index];
    if (char === "\\") {
      index += 1;
      continue;
    }

    if (char === "\"") {
      return index;
    }
  }

  return content.length - 1;
}

function skipToLineEnd(content: string, startIndex: number): number {
  let cursor = startIndex;
  while (cursor < content.length && content[cursor] !== "\n") {
    cursor += 1;
  }
  return cursor;
}

function isAlreadyTransposed(content: string): boolean {
  return /^\s*\\transpose\b/.test(content);
}

function ensureTrailingNewline(content: string, original: string): string {
  if (original.endsWith("\n") && !content.endsWith("\n")) {
    return `${content}\n`;
  }
  return content;
}

function indentBlock(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => (line.length > 0 ? `  ${line}` : line))
    .join("\n");
}
