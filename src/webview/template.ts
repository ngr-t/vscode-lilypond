import { chooseBestAnchor, scoreAnchorCandidate } from "../sync/anchorMatch";

export function getBasePreviewHtml(): string {
  const nonce = getNonce();
  const chooseBestAnchorFn = chooseBestAnchor.toString();
  const scoreAnchorCandidateFn = scoreAnchorCandidate.toString();

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>LilyPond Preview</title>
    <style>
      :root {
        font-family: "Segoe UI", Arial, sans-serif;
      }
      body {
        margin: 0;
        padding: 14px;
        background: #f5f6f9;
        color: #1f2430;
      }
      .header {
        background: #fff;
        border: 1px solid #d9dde8;
        border-radius: 10px;
        padding: 12px;
        margin-bottom: 14px;
      }
      .top-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
      }
      h1 {
        margin: 0;
        font-size: 15px;
      }
      .badge {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        border-radius: 999px;
        padding: 3px 8px;
        border: 1px solid #c8cde0;
        color: #4f5772;
        background: #eef2ff;
      }
      .badge[data-state="updating"] {
        color: #1b4d8c;
        border-color: #b2cef4;
        background: #e8f1ff;
      }
      .badge[data-state="error"] {
        color: #8e1f1f;
        border-color: #f0baba;
        background: #ffecec;
      }
      .status-line {
        margin: 8px 0 0;
        font-size: 12px;
        color: #555e79;
      }
      .meta {
        margin-top: 10px;
        display: grid;
        gap: 8px;
      }
      .meta-label {
        font-size: 11px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #646f8e;
      }
      code, pre {
        margin: 0;
        font-family: Menlo, Consolas, monospace;
        font-size: 12px;
        border-radius: 7px;
        padding: 8px;
      }
      code {
        display: block;
        background: #edf1fb;
        color: #1d2740;
        overflow-x: auto;
      }
      pre {
        background: #11151f;
        color: #f2f5fb;
        overflow: auto;
        max-height: 160px;
      }
      .pages {
        display: grid;
        gap: 14px;
      }
      .page {
        background: #fff;
        border: 1px solid #d9dde8;
        border-radius: 10px;
        padding: 10px;
      }
      .page-title {
        margin-bottom: 8px;
        font-size: 11px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #5f6782;
      }
      .svg-wrap {
        overflow: auto;
      }
      .svg-wrap svg {
        max-width: 100%;
        height: auto;
        display: block;
      }
      a.pnc-anchor {
        cursor: pointer;
      }
      a.pnc-anchor.pnc-selected path,
      a.pnc-anchor.pnc-selected rect,
      a.pnc-anchor.pnc-selected polygon,
      a.pnc-anchor.pnc-selected ellipse,
      a.pnc-anchor.pnc-selected circle,
      a.pnc-anchor.pnc-selected text,
      a.pnc-anchor.pnc-selected tspan,
      a.pnc-anchor.pnc-selected line,
      a.pnc-anchor.pnc-selected polyline,
      a.pnc-anchor.pnc-selected use {
        fill: #c21833 !important;
        stroke: #7d1022 !important;
        stroke-width: 0.2;
      }
      .empty {
        border: 1px dashed #c7cee1;
        border-radius: 10px;
        padding: 24px;
        text-align: center;
        color: #5f6782;
        background: #fff;
      }
    </style>
  </head>
  <body>
    <section class="header">
      <div class="top-row">
        <h1 id="doc-title">LilyPond Preview</h1>
        <span id="state-badge" class="badge" data-state="idle">Idle</span>
      </div>
      <p id="status-line" class="status-line">Preview ready.</p>
      <div class="meta">
        <div>
          <div class="meta-label">Command</div>
          <code id="command-line"></code>
        </div>
        <div>
          <div class="meta-label">LilyPond Output</div>
          <pre id="stderr-output"></pre>
        </div>
      </div>
    </section>

    <main id="pages" class="pages">
      <div class="empty">No rendered pages yet.</div>
    </main>

    <script nonce="${nonce}">
      const scoreAnchorCandidate = ${scoreAnchorCandidateFn};
      const chooseBestAnchor = ${chooseBestAnchorFn};
      const vscodeApi = acquireVsCodeApi();
      const docTitle = document.getElementById("doc-title");
      const badge = document.getElementById("state-badge");
      const statusLine = document.getElementById("status-line");
      const pages = document.getElementById("pages");
      const commandLine = document.getElementById("command-line");
      const stderrOutput = document.getElementById("stderr-output");
      let pointAnchors = [];
      let currentSelectedAnchor = null;

      function setStatus(state, message) {
        badge.dataset.state = state;
        badge.textContent = state === "updating" ? "Updating" : state === "error" ? "Error" : "Idle";
        statusLine.textContent = message || "";
      }

      function normalizeFilePath(value) {
        return String(value || "").replace(/\\/g, "/").toLowerCase();
      }

      function parseTextEditHref(href) {
        if (typeof href !== "string" || !href.startsWith("textedit://")) {
          return null;
        }

        const raw = decodeURIComponent(href.slice("textedit://".length));
        const segments = raw.split(":");
        if (segments.length < 3) {
          return null;
        }

        const last = segments[segments.length - 1];
        const secondLast = segments[segments.length - 2];
        const thirdLast = segments[segments.length - 3];
        if (!/^\d+$/.test(last) || !/^\d+$/.test(secondLast)) {
          return null;
        }

        const hasEndColumn = /^\d+$/.test(thirdLast);
        const filePath = segments.slice(0, hasEndColumn ? -3 : -2).join(":");
        const line = Number(hasEndColumn ? thirdLast : secondLast);
        const column = Number(hasEndColumn ? secondLast : last);
        const endColumn = hasEndColumn ? Number(last) : column;
        if (!Number.isFinite(line) || !Number.isFinite(column) || !Number.isFinite(endColumn)) {
          return null;
        }

        return {
          filePath,
          line,
          column,
          endColumn
        };
      }

      function clearSelectedAnchor() {
        if (currentSelectedAnchor) {
          currentSelectedAnchor.classList.remove("pnc-selected");
          currentSelectedAnchor = null;
        }
      }

      function bindPointAnchors() {
        pointAnchors = [];
        clearSelectedAnchor();

        const anchors = pages.querySelectorAll("a");
        anchors.forEach((anchor) => {
          const href = anchor.getAttribute("xlink:href") || anchor.getAttribute("href");
          const target = parseTextEditHref(href);
          if (!target) {
            return;
          }

          anchor.classList.add("pnc-anchor");
          anchor.addEventListener("click", (event) => {
            event.preventDefault();
            vscodeApi.postMessage({
              type: "previewClick",
              href
            });
          });

          pointAnchors.push({
            anchor,
            href,
            target,
            normalizedFilePath: normalizeFilePath(target.filePath)
          });
        });

        vscodeApi.postMessage({
          type: "debug",
          message: "anchorCount=" + pointAnchors.length
        });
      }

      function pickBestAnchor(cursorFilePath, line, column, hysteresisScore) {
        if (!pointAnchors.length) {
          return null;
        }

        const normalizedCursorPath = normalizeFilePath(cursorFilePath);
        const fileMatched = pointAnchors.filter((item) => item.normalizedFilePath === normalizedCursorPath);
        const candidates = fileMatched.length > 0 ? fileMatched : pointAnchors;

        const sameLine = candidates.filter((item) => item.target.line === line);
        const pool = sameLine.length > 0 ? sameLine : candidates;

        return chooseBestAnchor(pool, line, column, currentSelectedAnchor, hysteresisScore);
      }

      function highlightForCursor(payload) {
        const line = Number(payload.line);
        const column = Number(payload.column);
        if (!Number.isFinite(line) || !Number.isFinite(column)) {
          return;
        }

        const hysteresisScore = Number(payload.hysteresisScore);
        const best = pickBestAnchor(
          payload.filePath || "",
          line,
          column,
          Number.isFinite(hysteresisScore) ? Math.max(0, hysteresisScore) : 180
        );
        if (!best) {
          clearSelectedAnchor();
          vscodeApi.postMessage({
            type: "debug",
            message: "cursor-no-match " + (payload.filePath || "") + ":" + line + ":" + column
          });
          return;
        }

        if (currentSelectedAnchor && currentSelectedAnchor !== best.anchor) {
          currentSelectedAnchor.classList.remove("pnc-selected");
        }

        currentSelectedAnchor = best.anchor;
        currentSelectedAnchor.classList.add("pnc-selected");
        if (payload.autoScroll && typeof currentSelectedAnchor.scrollIntoView === "function") {
          currentSelectedAnchor.scrollIntoView({
            block: "center",
            inline: "center",
            behavior: "smooth"
          });
        }
        vscodeApi.postMessage({
          type: "debug",
          message:
            "cursor-match " +
            (payload.filePath || "") +
            ":" +
            line +
            ":" +
            column +
            " -> " +
            best.target.filePath +
            ":" +
            best.target.line +
            ":" +
            best.target.column
        });
      }

      window.addEventListener("message", (event) => {
        const message = event.data;
        if (!message || typeof message !== "object") {
          return;
        }

        if (message.type === "status") {
          setStatus(message.state, message.message);
          return;
        }

        if (message.type === "update") {
          const previousScroll = document.scrollingElement ? document.scrollingElement.scrollTop : 0;
          if (typeof message.title === "string" && message.title.length > 0) {
            docTitle.textContent = message.title;
          }
          setStatus("idle", message.statusText || "Rendered.");
          commandLine.textContent = message.command || "";
          stderrOutput.textContent = message.stderr || "";
          pages.innerHTML = message.pagesHtml && message.pagesHtml.length > 0
            ? message.pagesHtml
            : '<div class="empty">No rendered pages yet.</div>';
          bindPointAnchors();

          if (document.scrollingElement) {
            document.scrollingElement.scrollTop = previousScroll;
          }
          return;
        }

        if (message.type === "cursor") {
          highlightForCursor(message);
          return;
        }

        if (message.type === "cursorClear") {
          clearSelectedAnchor();
        }
      });

      vscodeApi.postMessage({ type: "previewReady" });
    </script>
  </body>
</html>`;
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
