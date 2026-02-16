export function wrapTranspose(content: string, fromPitch: string, toPitch: string): string {
  const inner = content.replace(/^\n+|\n+$/g, "");
  return `\\transpose ${fromPitch} ${toPitch} {\n${indentBlock(inner)}\n}`;
}

export function transposeWholeDocument(content: string, fromPitch: string, toPitch: string): string {
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

function indentBlock(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => (line.length > 0 ? `  ${line}` : line))
    .join("\n");
}
