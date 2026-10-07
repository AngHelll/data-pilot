import * as path from "node:path";
import * as vscode from "vscode";
import type { Diagnostic, QueryResult, TrustMode } from "@data-pilot/contracts";
import { formatCells } from "../format-cell";
import {
  type HostToWebviewMessage,
  type SerializedGrid,
  parseWebviewMessage,
} from "./messages";
import type { ExtensionEngineHost } from "../engine-host";
import { writeExportArtifact } from "../export-writer";
import { SavedQueryStore } from "../saved-query-store";
import {
  mergeIngestDiagnostics,
  planLooksRunnable,
  serializeDescribe,
} from "../describe-serialize";
import { logError, logInfo } from "../log";
import { createWebviewNonce, isCspNonce } from "./nonce";

/** VS Code custom editor view type — use with `vscode.openWith` and editor associations. */
export const DATA_PILOT_VIEW_TYPE = "dataPilot.dataset";

export interface MountDatasetViewOptions {
  engine: ExtensionEngineHost;
  savedQueryStore: SavedQueryStore;
  extensionUri: vscode.Uri;
  title: string;
}

function serializeGrid(
  mode: "preview" | "query",
  result: QueryResult,
  columnTypes?: SerializedGrid["columnTypes"],
): SerializedGrid {
  return {
    mode,
    columns: result.columns,
    ...(columnTypes !== undefined ? { columnTypes } : {}),
    rows: formatCells(result.rows),
    rowCountReturned: result.rowCountReturned,
    completion: result.completion,
    scope: result.scope,
    ...(result.totalCount !== undefined ? { totalCount: result.totalCount } : {}),
    ...(result.scannedBytes !== undefined ? { scannedBytes: result.scannedBytes } : {}),
    ...(result.scannedRows !== undefined ? { scannedRows: result.scannedRows } : {}),
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function panelHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  nonce: string,
  title: string,
): string {
  if (!isCspNonce(nonce)) {
    throw new Error("Webview nonce is not a valid CSP nonce");
  }
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "dataset-panel.css"),
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "dataset-panel.js"),
  );
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
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${escapeHtml(String(styleUri))}" />
</head>
<body>
  <h1 id="title">Data Pilot</h1>
  <p class="hint" id="loading">Loading dataset…</p>
  <div class="meta" id="meta"></div>
  <div id="trust"></div>
  <div class="row-actions" id="stale-row" hidden>
    <span class="warn" id="stale-banner"></span>
    <button id="reopen" type="button">Reopen dataset</button>
  </div>
  <section id="describe-section">
    <label>Dataset</label>
    <p class="hint" id="describe-meta"></p>
    <div class="table-wrap schema-wrap">
      <table id="schema"><thead><tr>
        <th>Column</th><th>Type</th><th>null (sample)</th><th>missing (sample)</th>
      </tr></thead><tbody></tbody></table>
    </div>
  </section>
  <section>
    <label>Parse &amp; ingest warnings</label>
    <ul class="diag" id="ingest-diagnostics"></ul>
    <p class="hint" id="ingest-empty">No warnings in the bounded preview sample.</p>
  </section>
  <section>
    <label for="dql">DQL 0.1</label>
    <textarea id="dql" placeholder='where country = "MX" | take 20'></textarea>
    <div class="row-actions">
      <button id="plan" type="button">Check query</button>
      <button id="run" type="button">Run query</button>
      <button id="save-query" type="button" disabled>Save query</button>
      <button id="export-query" type="button" disabled>Export result</button>
      <button id="cancel" type="button" disabled>Cancel</button>
    </div>
    <div class="row-actions">
      <label class="saved-label" for="saved-queries">Saved</label>
      <select id="saved-queries" disabled><option value="">— load saved query —</option></select>
    </div>
    <ul class="diag" id="dql-diagnostics"></ul>
    <p class="hint" id="dql-formatted"></p>
    <p class="cost" id="cost"></p>
  </section>
  <section>
    <label id="grid-label">Preview</label>
    <div class="table-wrap"><table id="grid"><thead></thead><tbody></tbody></table></div>
  </section>
  <section id="inspect-section">
    <label>Cell inspect</label>
    <p id="inspect-detail">Click a cell to inspect raw value and type.</p>
  </section>
  <section id="edit-section">
    <label>Fixture edit (trusted)</label>
    <div class="row-actions">
      <input id="edit-value" class="cell-edit" type="text" placeholder="New raw value" disabled />
      <button id="preview-edit" type="button" disabled>Preview diff</button>
      <button id="apply-edit" type="button" disabled>Apply save</button>
    </div>
    <pre class="diff" id="edit-diff"></pre>
  </section>
  <script nonce="${escapeHtml(nonce)}" src="${escapeHtml(String(scriptUri))}"></script>
</body>
</html>`;
}

function safePreview(raw: unknown): string {
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

export interface DatasetViewSurface {
  readonly webview: vscode.Webview;
  setTitle(title: string): void;
}

const viewSessions = new WeakMap<object, DatasetViewSession>();

function bindDatasetViewSession(
  owner: object,
  surface: DatasetViewSurface,
  options: MountDatasetViewOptions,
): DatasetViewSession {
  let session = viewSessions.get(owner);
  if (!session) {
    session = new DatasetViewSession(surface, options);
    viewSessions.set(owner, session);
    logInfo("Dataset webview session created");
  }
  return session;
}

/**
 * VS Code may call `resolveCustomEditor` more than once for the same `WebviewPanel`
 * (visibility, splits, etc.). Bind one webview session per panel — never reset HTML on re-resolve.
 */
export function ensureDatasetViewSession(
  panel: vscode.WebviewPanel,
  options: MountDatasetViewOptions,
): DatasetViewSession {
  const session = bindDatasetViewSession(
    panel,
    {
      webview: panel.webview,
      setTitle: (title) => {
        panel.title = title;
      },
    },
    options,
  );
  if (!panelSubscriptions.has(panel)) {
    panelSubscriptions.set(
      panel,
      panel.onDidDispose(() => {
        session.dispose();
        viewSessions.delete(panel);
        panelSubscriptions.delete(panel);
      }),
    );
  }
  return session;
}

const panelSubscriptions = new WeakMap<vscode.WebviewPanel, vscode.Disposable>();

/** Sidebar / Explorer webview — same UI as the custom editor, simpler lifecycle. */
export function ensureExplorerViewSession(
  view: vscode.WebviewView,
  options: MountDatasetViewOptions,
): DatasetViewSession {
  const session = bindDatasetViewSession(
    view,
    {
      webview: view.webview,
      setTitle: (title) => {
        view.title = title;
      },
    },
    options,
  );
  if (!viewSubscriptions.has(view)) {
    viewSubscriptions.set(
      view,
      view.onDidDispose(() => {
        session.dispose();
        viewSessions.delete(view);
        viewSubscriptions.delete(view);
      }),
    );
  }
  return session;
}

const viewSubscriptions = new WeakMap<vscode.WebviewView, vscode.Disposable>();

class DatasetViewSession {
  private readonly nonce: string;
  private currentFilePath: string | undefined;
  private fileWatcher: vscode.FileSystemWatcher | undefined;
  private webviewReady = false;
  private pendingPosts: HostToWebviewMessage[] = [];
  private undelivered: { message: HostToWebviewMessage; attempts: number }[] = [];
  private undeliveredTimer: ReturnType<typeof setTimeout> | undefined;
  private loadGeneration = 0;
  private lastSessionPayload:
    | Extract<HostToWebviewMessage, { type: "session" }>
    | undefined;

  constructor(
    private readonly surface: DatasetViewSurface,
    private readonly options: MountDatasetViewOptions,
  ) {
    this.nonce = createWebviewNonce();
    this.surface.webview.options = {
      enableScripts: true,
      localResourceRoots: [options.extensionUri],
    };
    // Listener before html. The external script posts `webviewReady` after it
    // loads; VS Code drops that message if nobody is subscribed yet.
    this.surface.webview.onDidReceiveMessage((raw: unknown) => {
      void this.onWebviewMessage(raw);
    });
    this.surface.webview.html = panelHtml(
      this.surface.webview,
      options.extensionUri,
      this.nonce,
      options.title,
    );
    logInfo("Dataset webview HTML assigned after message listener");
  }

  dispose(): void {
    if (this.undeliveredTimer !== undefined) {
      clearTimeout(this.undeliveredTimer);
      this.undeliveredTimer = undefined;
    }
    this.fileWatcher?.dispose();
    this.fileWatcher = undefined;
  }

  /** View became visible again — retry posts that the webview could not accept. */
  onSurfaceVisible(): void {
    this.flushUndelivered();
  }

  showIdle(message = "Open or focus a CSV/JSONL file — preview loads here (Rainbow-style, text editor stays open)."): void {
    this.post({ type: "idle", message });
  }

  private get engine(): ExtensionEngineHost {
    return this.options.engine;
  }

  private get savedQueryStore(): SavedQueryStore {
    return this.options.savedQueryStore;
  }

  private postInit(): void {
    const trustMode: TrustMode = vscode.workspace.isTrusted ? "trusted" : "untrusted-limited";
    this.post({
      type: "init",
      trustMode,
      canExecuteQuery: trustMode === "trusted",
      canEdit: this.engine.canEdit(),
      canExport: this.engine.canExport(),
      savedQueries: this.savedQueryStore.list(),
    });
  }

  private post(message: HostToWebviewMessage): void {
    if (message.type === "session") {
      this.lastSessionPayload = message;
    }
    if (!this.webviewReady) {
      this.pendingPosts.push(message);
      return;
    }
    void this.deliverToWebview(message);
  }

  private async deliverToWebview(message: HostToWebviewMessage, attempts = 0): Promise<void> {
    try {
      // VS Code webview postMessage JSON-serializes; clone first so failures
      // show up here instead of as a silent drop.
      const payload = JSON.parse(JSON.stringify(message)) as HostToWebviewMessage;
      const delivered = await this.surface.webview.postMessage(payload);
      if (!delivered) {
        if (attempts < 2) {
          this.undelivered.push({ message, attempts: attempts + 1 });
          this.scheduleUndeliveredFlush();
          return;
        }
        logError(`webview postMessage not delivered (type=${message.type})`);
        return;
      }
      logInfo(`host→webview delivered ${message.type}`);
    } catch (err) {
      logError(
        `webview postMessage failed (type=${message.type}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private scheduleUndeliveredFlush(): void {
    if (this.undeliveredTimer !== undefined) return;
    // Yield one turn. postMessage during resolveWebviewView can return false
    // before the document is attached. This does not mark the webview ready.
    this.undeliveredTimer = setTimeout(() => {
      this.undeliveredTimer = undefined;
      this.flushUndelivered();
    }, 0);
  }

  private flushUndelivered(): void {
    if (!this.webviewReady || this.undelivered.length === 0) return;
    const batch = this.undelivered;
    this.undelivered = [];
    for (const item of batch) {
      void this.deliverToWebview(item.message, item.attempts);
    }
  }

  /** Webview remounted (Explorer view shown again) — push last known UI state. */
  private resyncToWebview(): void {
    void this.deliverToWebview({
      type: "init",
      trustMode: vscode.workspace.isTrusted ? "trusted" : "untrusted-limited",
      canExecuteQuery: vscode.workspace.isTrusted,
      canEdit: this.engine.canEdit(),
      canExport: this.engine.canExport(),
      savedQueries: this.savedQueryStore.list(),
    });
    if (this.lastSessionPayload) {
      void this.deliverToWebview(this.lastSessionPayload);
    }
  }

  private markWebviewReady(): void {
    if (this.webviewReady) return;
    this.webviewReady = true;
    const pending = this.pendingPosts;
    this.pendingPosts = [];
    logInfo(
      `Dataset webview ready (flushing ${pending.length} queued message${pending.length === 1 ? "" : "s"})`,
    );
    this.postInit();
    for (const message of pending) {
      void this.deliverToWebview(message);
    }
  }

  private flushPendingPosts(): void {
    this.markWebviewReady();
  }

  private watchSourceFile(filePath: string): void {
    this.fileWatcher?.dispose();
    this.currentFilePath = filePath;
    const folder = vscode.Uri.file(path.dirname(filePath));
    const pattern = path.basename(filePath);
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, pattern),
    );
    let acceptStaleEvents = false;
    setTimeout(() => {
      acceptStaleEvents = true;
    }, 750);
    const notifyStale = (): void => {
      if (!acceptStaleEvents) return;
      this.post({
        type: "staleSource",
        message:
          "File changed on disk since open. Reopen to refresh preview, schema, and revision.",
      });
    };
    this.fileWatcher.onDidChange(notifyStale);
    this.fileWatcher.onDidCreate(notifyStale);
  }

  async loadDataset(
    filePath: string,
    token?: vscode.CancellationToken,
  ): Promise<boolean> {
    const generation = ++this.loadGeneration;
    logInfo(`Open dataset requested: ${filePath} (gen=${generation})`);
    try {
      const session = await this.engine.openDataset(filePath);
      if (token?.isCancellationRequested || generation !== this.loadGeneration) {
        return false;
      }
      this.watchSourceFile(filePath);
      this.surface.setTitle(filePath.split(/[/\\]/).pop() ?? "Data Pilot");
      logInfo(`Posting dataset session (gen=${generation})`);
      this.post({
        type: "session",
        handle: session.handle,
        describe: serializeDescribe(session.handle),
        ingestDiagnostics: mergeIngestDiagnostics(
          session.diagnostics,
          session.preview.diagnostics,
        ),
        preview: serializeGrid("preview", session.preview, session.handle.columns),
      });
      return true;
    } catch (err) {
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
      this.post({ type: "error", message });
      logError(`Open dataset failed: ${message}`);
      void vscode.window.showErrorMessage(`Data Pilot: ${message}`);
      return false;
    }
  }

  private async onWebviewMessage(raw: unknown): Promise<void> {
    const msg = parseWebviewMessage(raw);
    if (!msg) {
      logError(`Ignored webview message: ${safePreview(raw)}`);
      return;
    }

    if (msg.type === "webviewReady") {
      if (this.webviewReady) {
        logInfo("Dataset webview ready (again) — resync UI");
        this.resyncToWebview();
        return;
      }
      this.flushPendingPosts();
      return;
    }

    const showErr = (err: unknown): void => {
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
      this.post({ type: "error", message });
    };

    if (msg.type === "reopenDataset") {
      if (this.currentFilePath) {
        await this.loadDataset(this.currentFilePath);
      }
      return;
    }

    if (msg.type === "cancelQuery") {
      await this.engine.cancelActiveQuery();
      this.post({ type: "queryState", running: false });
      return;
    }

    if (msg.type === "inspectCell") {
      const generation = this.loadGeneration;
      try {
        const detail = await this.engine.inspectCell(msg.rowIndex, msg.column);
        if (generation !== this.loadGeneration) return;
        this.post({
          type: "inspectResult",
          rowIndex: msg.rowIndex,
          column: msg.column,
          display: detail.display,
          raw: detail.raw,
          inferredType: detail.inferredType,
        });
      } catch (err) {
        showErr(err);
      }
      return;
    }

    if (msg.type === "proposeEdit") {
      try {
        const preview = await this.engine.proposeEdit(msg.rowIndex, msg.column, msg.newRaw);
        this.post({ type: "editPreview", preview });
      } catch (err) {
        showErr(err);
      }
      return;
    }

    if (msg.type === "applyEdit") {
      try {
        const applied = await this.engine.applyEdit(msg.rowIndex, msg.column, msg.newRaw);
        if (!applied.written) {
          this.post({ type: "editPreview", preview: applied.editPreview });
          return;
        }
        void vscode.window.showInformationMessage(
          `Saved ${applied.editPreview.column} @ row ${applied.editPreview.rowIndex}`,
        );
        await this.loadDataset(applied.path);
      } catch (err) {
        showErr(err);
      }
      return;
    }

    if (msg.type === "loadSavedQuery") {
      const found = this.savedQueryStore
        .list()
        .find((q) => q.savedAtMs === msg.savedAtMs);
      if (found) {
        this.post({ type: "queryLoaded", dql: found.dql });
      }
      return;
    }

    if (msg.type === "saveQuery") {
      try {
        const plan = await this.engine.planQuery(msg.dql);
        if (!planLooksRunnable(plan.diagnostics)) {
          this.post({
            type: "dqlPlan",
            ok: false,
            diagnostics: plan.diagnostics,
          });
          return;
        }
        const saved = await this.engine.saveQuery(msg.dql);
        const queries = this.savedQueryStore.append(saved);
        this.post({ type: "savedQueries", queries });
        void vscode.window.showInformationMessage("Query saved to workspace state");
      } catch (err) {
        showErr(err);
      }
      return;
    }

    if (msg.type === "exportQuery") {
      try {
        const plan = await this.engine.planQuery(msg.dql);
        if (!planLooksRunnable(plan.diagnostics)) {
          this.post({
            type: "dqlPlan",
            ok: false,
            diagnostics: plan.diagnostics,
          });
          return;
        }
        const artifact = await this.engine.exportQueryResult(
          msg.dql,
          msg.format ?? "same-as-source",
        );
        const written = await writeExportArtifact(artifact);
        if (written) {
          this.post({
            type: "exportDone",
            path: written,
            rowCount: artifact.rowCount,
          });
          void vscode.window.showInformationMessage(
            `Exported ${artifact.rowCount} rows to ${written}`,
          );
        }
      } catch (err) {
        showErr(err);
      }
      return;
    }

    if (msg.type === "planDql") {
      try {
        const plan = await this.engine.planQuery(msg.dql);
        const ok = planLooksRunnable(plan.diagnostics);
        this.post({
          type: "dqlPlan",
          ok,
          ...(plan.formatted !== undefined ? { formatted: plan.formatted } : {}),
          diagnostics: plan.diagnostics,
        });
      } catch (err) {
        showErr(err);
      }
      return;
    }

    if (msg.type === "runQuery") {
      const generation = this.loadGeneration;
      try {
        const plan = await this.engine.planQuery(msg.dql);
        if (generation !== this.loadGeneration) return;
        const ok = planLooksRunnable(plan.diagnostics);
        this.post({
          type: "dqlPlan",
          ok,
          ...(plan.formatted !== undefined ? { formatted: plan.formatted } : {}),
          diagnostics: plan.diagnostics,
        });
        if (!ok) return;
      } catch (err) {
        showErr(err);
        return;
      }

      this.post({ type: "queryState", running: true });
      try {
        const result = await this.engine.executeQuery(msg.dql);
        if (generation !== this.loadGeneration) return;
        this.post({
          type: "queryResult",
          result: serializeGrid("query", result),
          diagnostics: result.diagnostics,
        });
      } catch (err) {
        showErr(err);
      } finally {
        this.post({ type: "queryState", running: false });
      }
    }
  }
}

/** @deprecated Use vscode.openWith(uri, DATA_PILOT_VIEW_TYPE) — kept for tests. */
export class DatasetPanel {
  static async open(
    engine: ExtensionEngineHost,
    context: vscode.ExtensionContext,
    savedQueries: SavedQueryStore,
    filePath: string,
  ): Promise<void> {
    await vscode.commands.executeCommand(
      "vscode.openWith",
      vscode.Uri.file(filePath),
      DATA_PILOT_VIEW_TYPE,
    );
  }
}
