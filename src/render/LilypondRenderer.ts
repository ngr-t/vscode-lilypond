import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { getLilypondBinaryPath } from "../config/settings";
import { rewriteTexteditTargets } from "../sync/textEdit";

export const CANCEL_GRACE_MS = 1200;

export type RenderOutput = {
  pagesHtml: string;
  pagesCount: number;
  command: string;
  stderr: string;
  elapsedMs: number;
};

export type SpawnHandle = {
  token: number;
  uri: string;
  version: number;
  process: ChildProcessWithoutNullStreams;
};

export class LilypondRenderer {
  private readonly extensionContext: vscode.ExtensionContext;

  constructor(extensionContext: vscode.ExtensionContext) {
    this.extensionContext = extensionContext;
  }

  async ensureStorageDirectories(): Promise<void> {
    await Promise.all([
      fs.mkdir(path.join(this.extensionContext.globalStorageUri.fsPath, "preview-cache"), { recursive: true }),
      fs.mkdir(path.join(this.extensionContext.globalStorageUri.fsPath, "font-cache"), { recursive: true })
    ]);
  }

  async renderDocument(
    document: vscode.TextDocument,
    token: number,
    onSpawn: (handle: SpawnHandle) => void,
    onClearSpawn: (token: number) => void
  ): Promise<RenderOutput> {
    return this.renderContent(document, document.getText(), token, onSpawn, onClearSpawn);
  }

  async renderContent(
    document: vscode.TextDocument,
    content: string,
    token: number,
    onSpawn: (handle: SpawnHandle) => void,
    onClearSpawn: (token: number) => void
  ): Promise<RenderOutput> {
    const { inputPath, outputBase, previewDir, sourceDir, lilypondPath, args, fontCacheDir } =
      await this.prepareRenderContext(document);
    const command = `${lilypondPath} ${args.map(quoteArg).join(" ")}`;

    await fs.writeFile(inputPath, content, "utf8");
    await this.cleanupPreviousOutputs(previewDir);

    const startedAt = Date.now();
    const stderr = await runLilypond(
      {
        token,
        lilypondPath,
        args,
        cwd: sourceDir,
        fontCacheDir,
        uri: document.uri.toString(),
        version: document.version
      },
      onSpawn,
      onClearSpawn
    );

    const svgFiles = (await fs.readdir(previewDir))
      .filter((name) => name.startsWith("result") && name.endsWith(".svg"))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (svgFiles.length === 0) {
      throw new Error("LilyPond completed without generating SVG output.");
    }

    const pagesHtml = (
      await Promise.all(
        svgFiles.map(async (fileName, index) => {
          const rawSvg = await fs.readFile(path.join(previewDir, fileName), "utf8");
          const rewrittenSvg = rewriteTexteditTargets(rawSvg, inputPath, document.fileName);
          const safeSvg = stripScriptTags(rewrittenSvg);
          return `<section class=\"page\"><div class=\"page-title\">Page ${index + 1}</div><div class=\"svg-wrap\">${safeSvg}</div></section>`;
        })
      )
    ).join("\n");

    return {
      pagesHtml,
      pagesCount: svgFiles.length,
      command,
      stderr,
      elapsedMs: Date.now() - startedAt
    };
  }

  async exportPdf(document: vscode.TextDocument): Promise<string> {
    const { inputPath, sourceDir, lilypondPath, fontCacheDir } = await this.prepareRenderContext(document);
    const sourceBaseName = path.parse(document.fileName).name;
    const outputBase = path.join(sourceDir, sourceBaseName);

    await fs.writeFile(inputPath, document.getText(), "utf8");

    await runLilypond(
      {
        token: 0,
        lilypondPath,
        args: ["-o", outputBase, "-I", sourceDir, inputPath],
        cwd: sourceDir,
        fontCacheDir,
        uri: document.uri.toString(),
        version: document.version
      },
      () => {
        // Export flow does not use render cancellation tracking.
      },
      () => {
        // Export flow does not use render cancellation tracking.
      }
    );

    const pdfPath = `${outputBase}.pdf`;
    await fs.stat(pdfPath);
    return pdfPath;
  }

  async exportMidi(document: vscode.TextDocument): Promise<string> {
    const { inputPath, sourceDir, lilypondPath, fontCacheDir } = await this.prepareRenderContext(document);
    const sourceBaseName = path.parse(document.fileName).name;
    const outputBase = path.join(sourceDir, sourceBaseName);

    await fs.writeFile(inputPath, document.getText(), "utf8");

    await runLilypond(
      {
        token: 0,
        lilypondPath,
        args: ["-o", outputBase, "-I", sourceDir, inputPath],
        cwd: sourceDir,
        fontCacheDir,
        uri: document.uri.toString(),
        version: document.version
      },
      () => {
        // Export flow does not use render cancellation tracking.
      },
      () => {
        // Export flow does not use render cancellation tracking.
      }
    );

    const midiPath = `${outputBase}.midi`;
    const midPath = `${outputBase}.mid`;

    try {
      await fs.stat(midiPath);
      return midiPath;
    } catch {
      await fs.stat(midPath);
      return midPath;
    }
  }

  private async prepareRenderContext(document: vscode.TextDocument): Promise<{
    previewDir: string;
    inputPath: string;
    outputBase: string;
    sourceDir: string;
    lilypondPath: string;
    args: string[];
    fontCacheDir: string;
  }> {
    const lilypondPath = getLilypondBinaryPath();

    const docKey = Buffer.from(document.uri.toString(), "utf8").toString("base64url");
    const previewDir = path.join(this.extensionContext.globalStorageUri.fsPath, "preview-cache", docKey);
    const fontCacheDir = path.join(this.extensionContext.globalStorageUri.fsPath, "font-cache");
    const inputPath = path.join(previewDir, "input.ly");
    const outputBase = path.join(previewDir, "result");
    const sourceDir = path.dirname(document.fileName);

    await fs.mkdir(previewDir, { recursive: true });
    await fs.mkdir(fontCacheDir, { recursive: true });

    const args = ["-dbackend=svg", "-dpoint-and-click", "-o", outputBase, "-I", sourceDir, inputPath];

    return {
      previewDir,
      inputPath,
      outputBase,
      sourceDir,
      lilypondPath,
      args,
      fontCacheDir
    };
  }

  private async cleanupPreviousOutputs(previewDir: string): Promise<void> {
    const entries = await fs.readdir(previewDir);
    await Promise.all(
      entries
        .filter((entry) => entry.startsWith("result") && entry.endsWith(".svg"))
        .map(async (entry) => fs.unlink(path.join(previewDir, entry)))
    );
  }
}

async function runLilypond(
  input: {
    token: number;
    lilypondPath: string;
    args: string[];
    cwd: string;
    fontCacheDir: string;
    uri: string;
    version: number;
  },
  onSpawn: (handle: SpawnHandle) => void,
  onClearSpawn: (token: number) => void
): Promise<string> {
  const child = spawn(input.lilypondPath, input.args, {
    cwd: input.cwd,
    windowsHide: true,
    env: {
      ...process.env,
      XDG_CACHE_HOME: input.fontCacheDir
    }
  });

  onSpawn({
    token: input.token,
    uri: input.uri,
    version: input.version,
    process: child
  });

  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  await new Promise<void>((resolve, reject) => {
    child.once("error", (error) => {
      onClearSpawn(input.token);
      reject(error);
    });

    child.once("close", (code, signal) => {
      onClearSpawn(input.token);

      if (code === 0) {
        resolve();
        return;
      }

      const trimmedStderr = stderr.trim();
      const detail =
        trimmedStderr ||
        `LilyPond exited with code ${typeof code === "number" ? String(code) : "unknown"}${
          signal ? ` (signal ${signal})` : ""
        }.`;
      reject(new Error(detail));
    });
  });

  return stderr;
}

function stripScriptTags(value: string): string {
  return value.replace(/<script[\s\S]*?<\/script>/gi, "");
}

function quoteArg(value: string): string {
  if (/^[a-zA-Z0-9_./:-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}
