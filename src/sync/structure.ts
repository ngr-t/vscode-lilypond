export type StructureNode = {
  label: string;
  kind: "block" | "assignment";
  startLine: number;
  endLine: number;
};

const BLOCK_PATTERN = /\\(score|new|header|layout|midi|paper|book|bookpart|context)\b/;
const ASSIGNMENT_PATTERN = /^\s*([a-zA-Z][\w-]*)\s*=\s*/;

export function parseStructureNodes(content: string): StructureNode[] {
  const lines = content.split(/\r?\n/);
  const nodes: StructureNode[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].replace(/%.*$/, "");

    const assignment = line.match(ASSIGNMENT_PATTERN);
    if (assignment) {
      nodes.push({
        label: `${assignment[1]} =`,
        kind: "assignment",
        startLine: i,
        endLine: i
      });
      continue;
    }

    const block = line.match(BLOCK_PATTERN);
    if (block) {
      nodes.push({
        label: `\\${block[1]}`,
        kind: "block",
        startLine: i,
        endLine: findBlockEnd(lines, i)
      });
    }
  }

  return nodes;
}

function findBlockEnd(lines: string[], startLine: number): number {
  let depth = 0;
  let seenBrace = false;

  for (let i = startLine; i < lines.length; i += 1) {
    const sanitized = lines[i].replace(/%.*$/, "");
    for (const char of sanitized) {
      if (char === "{") {
        depth += 1;
        seenBrace = true;
      } else if (char === "}") {
        depth -= 1;
      }
    }

    if (seenBrace && depth <= 0) {
      return i;
    }
  }

  return startLine;
}
