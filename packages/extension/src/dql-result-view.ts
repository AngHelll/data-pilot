import * as vscode from "vscode";
import { fileName, resultTargetText } from "./dql-link";
import { createWebviewNonce, isCspNonce } from "./webview/nonce";

export interface DqlResultPayload {
  datasetPath: string;
  columns: string[];
  rows: string[][];
  rowCountReturned: number;
  completion: string;
  diagnostics: string[];
}

export type ResultPanelUpdate = "updated" | "stale" | "closed";

/** Read-only run output. A late response does not replace a newer run. Run does not create this panel. */
export class DqlResultView implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private generation = 0;
  private ready = false;
  private pending: DqlResultPayload | undefined;
  private lastPayload: DqlResultPayload | undefined;
  private shownPath: string | undefined;
  private nextPath: string | undefined;
  private readonly nonce = createWebviewNonce();

  constructor(private readonly extensionUri: vscode.Uri) {}

  isOpen(): boolean {
    return this.panel !== undefined;
  }

  /** Remember the newest result. Does not open a panel. */
  noteResult(generation: number, payload: DqlResultPayload): boolean {
    if (generation < this.generation) return false;
    this.generation = generation;
    this.lastPayload = payload;
    this.shownPath = payload.datasetPath;
    return true;
  }

  /** Update the panel already open, in the column it occupies. */
  updateOpen(generation: number, payload: DqlResultPayload): ResultPanelUpdate {
    if (!this.noteResult(generation, payload)) return "stale";
    if (!this.panel) return "closed";
    this.applyTitle(this.panel);
    if (this.panel.viewColumn !== undefined) {
      this.panel.reveal(this.panel.viewColumn, true);
    }
    this.postPayload(this.panel, payload);
    return "updated";
  }

  /** Explicit action. Shows the last painted result beside. Does not execute. */
  openBeside(): boolean {
    if (!this.lastPayload) return false;
    const panel = this.ensurePanel(vscode.ViewColumn.Beside);
    this.applyTitle(panel);
    panel.reveal(vscode.ViewColumn.Beside, true);
    this.postPayload(panel, this.lastPayload);
    return true;
  }

  /** The query now in front. Does not open the result view. */
  noteActive(nextPath: string | undefined): void {
    this.nextPath = nextPath;
    if (!this.panel) return;
    this.applyTitle(this.panel);
    void this.panel.webview.postMessage({
      type: "target",
      text: resultTargetText(this.shownPath, nextPath),
    });
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }

  private postPayload(panel: vscode.WebviewPanel, payload: DqlResultPayload): void {
    const message = {
      type: "result",
      generation: this.generation,
      payload,
      targetText: resultTargetText(this.shownPath, this.nextPath ?? payload.datasetPath),
    };
    if (!this.ready) {
      this.pending = payload;
      return;
    }
    void panel.webview.postMessage(message);
  }

  private ensurePanel(viewColumn: vscode.ViewColumn): vscode.WebviewPanel {
    if (this.panel) return this.panel;
    this.ready = false;
    const panel = vscode.window.createWebviewPanel(
      "dataPilot.dqlResult",
      "DQL result",
      { viewColumn, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [this.extensionUri] },
    );
    panel.onDidDispose(() => {
      if (this.panel === panel) {
        this.panel = undefined;
        this.ready = false;
      }
    });
    panel.webview.onDidReceiveMessage((raw: unknown) => {
      if (
        typeof raw === "object" &&
        raw !== null &&
        (raw as { type?: string }).type === "webviewReady"
      ) {
        this.ready = true;
        if (this.pending) {
          const payload = this.pending;
          this.pending = undefined;
          void panel.webview.postMessage({
            type: "result",
            generation: this.generation,
            payload,
            targetText: resultTargetText(this.shownPath, this.nextPath ?? payload.datasetPath),
          });
        }
      }
    });
    panel.webview.html = resultHtml(panel.webview, this.nonce);
    this.panel = panel;
    return panel;
  }

  private applyTitle(panel: vscode.WebviewPanel): void {
    const path = this.nextPath ?? this.shownPath;
    panel.title = path ? `DQL result · ${fileName(path)}` : "DQL result";
  }
}

function resultHtml(webview: vscode.Webview, nonce: string): string {
  if (!isCspNonce(nonce)) {
    throw new Error("Webview nonce is not a valid CSP nonce");
  }
  const csp = [
    "default-src 'none'",
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, "&quot;")}" />
  <style nonce="${nonce}">
    body { color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); margin: 0; padding: 12px 16px 24px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border-bottom: 1px solid var(--vscode-panel-border); padding: 4px 8px; text-align: left; white-space: nowrap; }
    #status { font-weight: 600; margin-top: 0; }
    .foot { margin-top: 12px; opacity: 0.9; }
    .err { color: var(--vscode-editorError-foreground); }
  </style>
</head>
<body>
  <p id="status">Run a query to see rows.</p>
  <div id="grid"></div>
  <p id="foot" class="foot"></p>
  <ul id="diags"></ul>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const status = document.getElementById("status");
    const grid = document.getElementById("grid");
    const foot = document.getElementById("foot");
    const diags = document.getElementById("diags");
    let seen = 0;
    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (!msg) return;
      if (msg.type === "target") {
        status.textContent = msg.text || "";
        return;
      }
      if (msg.type !== "result") return;
      if (typeof msg.generation === "number" && msg.generation < seen) return;
      seen = msg.generation || seen;
      const payload = msg.payload || {};
      status.textContent = msg.targetText || "";
      foot.textContent = (payload.rowCountReturned ?? 0) + " rows · " + (payload.completion || "");
      diags.replaceChildren();
      for (const line of payload.diagnostics || []) {
        const li = document.createElement("li");
        li.className = "err";
        li.textContent = line;
        diags.appendChild(li);
      }
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const hr = document.createElement("tr");
      for (const col of payload.columns || []) {
        const th = document.createElement("th");
        th.textContent = col;
        hr.appendChild(th);
      }
      thead.appendChild(hr);
      const tbody = document.createElement("tbody");
      for (const row of payload.rows || []) {
        const tr = document.createElement("tr");
        for (const cell of row) {
          const td = document.createElement("td");
          td.textContent = cell;
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.append(thead, tbody);
      grid.replaceChildren(table);
    });
    vscode.postMessage({ type: "webviewReady" });
  </script>
</body>
</html>`;
}
