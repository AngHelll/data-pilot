import * as vscode from "vscode";
import {
  setInspectorHosted,
  setInspectorSink,
  type InspectorCell,
  type InspectorEvent,
} from "./inspector-hub";
import {
  broadcastInspectorHosted,
  copyActiveCell,
  editActiveCell,
  republishActiveInspector,
} from "./webview/dataset-panel";
import { createWebviewNonce, isCspNonce } from "./webview/nonce";

export const CELL_INSPECTOR_VIEW_ID = "dataPilot.cellInspector";

const MAX_CELL_LENGTH = 8_192;

/**
 * Cell inspector in the Data Pilot container. The contribution does not move it.
 * Copy, diff, and Apply go through the active dataset editor.
 */
export class CellInspectorView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private ready = false;
  private cell: InspectorCell | undefined;
  private diff = "";
  private notice = "";

  constructor(private readonly extensionUri: vscode.Uri) {}

  dispose(): void {
    setInspectorSink(undefined);
    setInspectorHosted(false);
    broadcastInspectorHosted(false);
    this.view = undefined;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    setInspectorSink((event) => {
      this.onInspectorEvent(event);
    });
    webviewView.onDidDispose(() => {
      if (this.view === webviewView) this.dispose();
    });
    webviewView.onDidChangeVisibility(() => {
      this.publishHosted(webviewView.visible);
    });
    this.ready = false;
    webviewView.webview.onDidReceiveMessage((raw: unknown) => {
      void this.onMessage(raw);
    });
    webviewView.webview.html = inspectorHtml(webviewView.webview, this.extensionUri);
    this.publishHosted(webviewView.visible);
    republishActiveInspector();
  }

  private publishHosted(hosted: boolean): void {
    setInspectorHosted(hosted);
    broadcastInspectorHosted(hosted);
  }

  private onInspectorEvent(event: InspectorEvent): void {
    if (event.type === "cell") {
      this.cell = event.cell;
      this.diff = "";
      this.notice = "";
    } else if (event.type === "empty") {
      this.cell = undefined;
      this.diff = "";
      this.notice = "";
    } else if (event.type === "diff") {
      this.diff = event.diff;
      this.notice = "";
    } else {
      this.notice = event.message;
    }
    this.render();
  }

  private render(): void {
    if (!this.ready) return;
    const cell = this.cell;
    void this.view?.webview.postMessage(
      cell
        ? {
            type: "show",
            fileName: cell.fileName,
            rowIndex: cell.rowIndex,
            column: cell.column,
            inferredType: cell.inferredType,
            raw: cell.raw,
            canEdit: cell.canEdit,
            diff: this.diff,
            notice: this.notice,
          }
        : { type: "clear" },
    );
  }

  private async onMessage(raw: unknown): Promise<void> {
    if (isReadyMessage(raw)) {
      this.ready = true;
      this.render();
      return;
    }
    const msg = parseInspectorMessage(raw);
    const cell = this.cell;
    if (!msg || !cell) return;
    if (msg.type === "copy") {
      await copyActiveCell(cell.filePath, cell.raw);
      return;
    }
    await editActiveCell(msg.type, cell.filePath, cell.rowIndex, cell.column, msg.newRaw);
  }
}

function isReadyMessage(raw: unknown): boolean {
  return typeof raw === "object" && raw !== null && (raw as { type?: unknown }).type === "ready";
}

function parseInspectorMessage(
  raw: unknown,
): { type: "copy" } | { type: "propose" | "apply"; newRaw: string } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const msg = raw as Record<string, unknown>;
  if (msg.type === "copy") return { type: "copy" };
  if (msg.type !== "propose" && msg.type !== "apply") return null;
  if (typeof msg.newRaw !== "string" || msg.newRaw.length > MAX_CELL_LENGTH) return null;
  return { type: msg.type, newRaw: msg.newRaw };
}

function inspectorHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = createWebviewNonce();
  if (!isCspNonce(nonce)) throw new Error("Webview nonce is not a valid CSP nonce");
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "dataset-panel.css"));
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Cell inspector</title>
  <link rel="stylesheet" href="${escapeHtml(String(styleUri))}" />
</head>
<body class="cell-inspector">
  <p class="hint" id="empty">Select a cell on the Data tab.</p>
  <div id="detail" hidden>
    <p class="hint" id="file"></p>
    <dl class="inspect-fields">
      <dt>Column</dt><dd id="column">—</dd>
      <dt>Type</dt><dd id="type">—</dd>
      <dt>Raw value</dt><dd id="raw">—</dd>
    </dl>
    <p class="hint" id="notice"></p>
    <button id="copy" type="button">Copy value</button>
    <label class="toolbar-label" for="edit-value">Edit value</label>
    <input id="edit-value" class="cell-edit" type="text" placeholder="New raw value" />
    <div class="row-actions">
      <button id="preview-edit" type="button">Preview diff</button>
      <button id="apply-edit" type="button">Apply save</button>
    </div>
    <pre class="diff" id="diff"></pre>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const empty = document.getElementById("empty");
    const detail = document.getElementById("detail");
    const fileEl = document.getElementById("file");
    const columnEl = document.getElementById("column");
    const typeEl = document.getElementById("type");
    const rawEl = document.getElementById("raw");
    const noticeEl = document.getElementById("notice");
    const editEl = document.getElementById("edit-value");
    const previewBtn = document.getElementById("preview-edit");
    const applyBtn = document.getElementById("apply-edit");
    const diffEl = document.getElementById("diff");
    let shownKey = "";
    function text(el, value) { if (el) el.textContent = value; }
    function setEdit(on) {
      editEl.disabled = !on;
      previewBtn.disabled = !on;
      applyBtn.disabled = !on;
    }
    previewBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "propose", newRaw: editEl.value });
    });
    applyBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "apply", newRaw: editEl.value });
    });
    document.getElementById("copy").addEventListener("click", () => {
      vscode.postMessage({ type: "copy" });
    });
    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (!msg || typeof msg.type !== "string") return;
      if (msg.type === "clear") {
        shownKey = "";
        empty.hidden = false;
        detail.hidden = true;
        return;
      }
      if (msg.type !== "show") return;
      empty.hidden = true;
      detail.hidden = false;
      const key = String(msg.fileName || "") + "\0" + String(msg.rowIndex) + "\0" + String(msg.column || "");
      text(fileEl, msg.fileName || "");
      text(columnEl, msg.column || "—");
      const inferred = typeof msg.inferredType === "string" ? msg.inferredType : "";
      text(typeEl, inferred ? inferred.charAt(0).toUpperCase() + inferred.slice(1) : "—");
      text(rawEl, typeof msg.raw === "string" ? msg.raw : "");
      text(noticeEl, msg.notice || "");
      text(diffEl, msg.diff || "");
      setEdit(!!msg.canEdit);
      if (key !== shownKey) {
        shownKey = key;
        editEl.value = typeof msg.raw === "string" ? msg.raw : "";
      }
    });
    vscode.postMessage({ type: "ready" });
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
