import * as fs from "fs/promises";
import * as path from "path";

export type OutputArtifact = {
  path: string;
  type: string;
  mtime: number;
};

export async function collectArtifacts(scoreFilePath: string): Promise<OutputArtifact[]> {
  const dir = path.dirname(scoreFilePath);
  const base = path.parse(scoreFilePath).name;
  const entries = await fs.readdir(dir);
  const candidates = entries.filter(
    (name) =>
      (name === `${base}.pdf` || name === `${base}.midi` || name === `${base}.mid`) ||
      (name.startsWith(`${base}-`) &&
        (name.endsWith(".pdf") || name.endsWith(".midi") || name.endsWith(".mid") || name.endsWith(".svg")))
  );

  const artifacts: OutputArtifact[] = [];
  for (const name of candidates) {
    const fullPath = path.join(dir, name);
    try {
      const stat = await fs.stat(fullPath);
      if (!stat.isFile()) {
        continue;
      }

      artifacts.push({
        path: fullPath,
        type: path.extname(name).slice(1).toUpperCase(),
        mtime: stat.mtimeMs
      });
    } catch {
      // Ignore files that disappear during scan.
    }
  }

  artifacts.sort((a, b) => b.mtime - a.mtime);
  return artifacts;
}
