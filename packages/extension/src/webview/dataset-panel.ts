import * as path from "node:path";
import * as vscode from "vscode";
import type { ColumnMeta, DataValue, Diagnostic, KeyDiffResult, QueryResult, TrustMode } from "@data-pilot/contracts";
import { assertOpAllowed } from "@data-pilot/core";
import { dropToolbarChip, parseDql, ParseError, readToolbarChips } from "@data-pilot/dql";
import { datasetColorToken } from "../dataset-color";
import { activityOutcome, activityText, columnPresentation, gridFooter, resultTabLabel } from "../editor-chrome";
import { queryStagesPage } from "../row-window";
import { noteEditorActivity } from "../editor-activity";
import type { HostJobLog } from "../host-jobs";
import { filterToDql } from "../filter-dql";
import { formatCell, formatCells } from "../format-cell";
import {
  type HostToWebviewMessage,
  type SerializedGrid,
  parseWebviewMessage,
} from "./messages";
import type { ExtensionEngineHost } from "../engine-host";
import { writeExportArtifact } from "../export-writer";
import { SavedQueryStore } from "../saved-query-store";
import { rememberDatasetPath, savedQueryDisplayName, savedQueryNeedsName } from "../saved-query-tree";
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
  jobs: HostJobLog;
  extensionUri: vscode.Uri;
  title: string;
}

function serializeGrid(
  mode: "preview" | "query",
  result: QueryResult,
  columnTypes?: SerializedGrid["columnTypes"],
  elapsedMs?: number,
  remembered?: ReadonlyMap<string, { pill: boolean; alignEnd: boolean }>,
): SerializedGrid {
  const styles = gridStyles(result.columns, columnTypes, result.rows, remembered);
  return {
    mode,
    columns: result.columns,
    ...(columnTypes !== undefined ? { columnTypes } : {}),
    rows: formatCells(result.rows),
    ...(result.sourceRowIndexes !== undefined
      ? { sourceRowIndexes: result.sourceRowIndexes }
      : {}),
    rowCountReturned: result.rowCountReturned,
    completion: result.completion,
    scope: result.scope,
    ...(result.totalCount !== undefined ? { totalCount: result.totalCount } : {}),
    ...(result.scannedBytes !== undefined ? { scannedBytes: result.scannedBytes } : {}),
    ...(result.scannedRows !== undefined ? { scannedRows: result.scannedRows } : {}),
    footer: gridFooter({
      surface: mode === "preview" ? "Preview" : "Result",
      rowCountReturned: result.rowCountReturned,
      completion: result.completion,
      ...(elapsedMs !== undefined ? { elapsedMs } : {}),
    }),
    cellPill: styles.map((style) => style.pill),
    cellAlignEnd: styles.map((style) => style.alignEnd),
  };
}

function gridStyles(
  columns: readonly string[],
  types: readonly ColumnMeta[] | undefined,
  rows: readonly DataValue[][],
  remembered?: ReadonlyMap<string, { pill: boolean; alignEnd: boolean }>,
): { pill: boolean; alignEnd: boolean }[] {
  return columns.map((name, index) => {
    const known = remembered?.get(name);
    if (known) return known;
    const meta = types?.find((column) => column.name === name) ?? types?.[index];
    const seen = rows.flatMap((row) => {
      const cell = row[index];
      return cell?.kind === "string" ? [cell.value] : [];
    });
    const style = columnPresentation({
      inferredType: meta?.inferredType ?? "",
      ...(meta?.distinctCountSample !== undefined
        ? { distinctCountSample: meta.distinctCountSample }
        : {}),
      seenValues: seen,
    });
    return { pill: style.pill, alignEnd: style.align === "end" };
  });
}

function rememberStyles(
  columns: readonly ColumnMeta[],
  rows: readonly DataValue[][],
): Map<string, { pill: boolean; alignEnd: boolean }> {
  const styles = gridStyles(
    columns.map((column) => column.name),
    columns,
    rows,
  );
  return new Map(columns.map((column, index) => [column.name, styles[index]!]));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function editorPanelHtml(
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
<html lang="en" class="editor-root">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${escapeHtml(String(styleUri))}" />
</head>
<body data-layout="editor" class="inspector-collapsed">
  <div class="editor-split">
  <div class="editor-main">
  <div class="editor-chrome">
  <header class="editor-head" id="editor-head">
    <div class="editor-title-row">
      <span id="dataset-color" class="dataset-color" hidden></span>
      <h1 id="title">Data Pilot</h1>
      <button id="run" type="button">Run query</button>
      <button id="open-query" class="quiet" type="button">Open query beside</button>
      <button id="cancel" class="quiet" type="button" hidden>Cancel</button>
    </div>
    <p class="hint" id="loading">Loading dataset…</p>
    <p class="meta" id="editor-format"></p>
    <div id="trust"></div>
    <div class="row-actions" id="stale-row" hidden>
      <span class="warn" id="stale-banner"></span>
      <button id="reopen" type="button">Reopen dataset</button>
    </div>
    <div class="row-actions" id="revert-row" hidden>
      <button id="revert-edit" class="quiet" type="button">Revert last edit</button>
    </div>
  </header>
  <details>
    <summary>Schema</summary>
    <p class="meta" id="schema-path" hidden><span class="path-label">Path</span> <span id="meta"></span></p>
    <section id="describe-section">
      <p class="hint" id="describe-meta"></p>
      <div class="table-wrap schema-wrap">
        <table id="schema"><thead><tr>
          <th>Column</th><th>Type</th><th>null (sample)</th><th>missing (sample)</th>
        </tr></thead><tbody></tbody></table>
      </div>
    </section>
  </details>
  <details id="ingest-details" hidden>
    <summary>Parse warnings</summary>
    <ul class="diag" id="ingest-diagnostics"></ul>
  </details>
  <details id="query-details">
    <summary id="query-summary">Query</summary>
    <textarea id="dql" placeholder='where country = "MX" | take 20'></textarea>
    <div class="row-actions" id="query-actions">
      <button id="save-query" class="quiet" type="button" hidden>Save query</button>
    </div>
    <ul class="diag" id="dql-diagnostics"></ul>
    <p class="hint" id="dql-formatted"></p>
    <p class="cost" id="cost"></p>
  </details>
  </div>
  <div class="editor-tabs">
    <div class="tab-bar" role="tablist" aria-label="Data Pilot">
      <span class="tab-owner">Data Pilot</span>
      <button type="button" class="tab" id="tab-data" role="tab" aria-selected="true" aria-controls="panel-data">Data</button>
      <button type="button" class="tab" id="tab-result" role="tab" aria-selected="false" aria-controls="panel-result" hidden>Result</button>
      <button type="button" class="tab" id="tab-compare" role="tab" aria-selected="false" aria-controls="panel-compare" hidden>Compare</button>
      <button type="button" class="tab" id="tab-profile" role="tab" aria-selected="false" aria-controls="panel-profile">Profile</button>
      <button type="button" class="tab" id="tab-changes" role="tab" aria-selected="false" aria-controls="panel-changes" hidden>Changes</button>
    </div>
    <div id="panel-data" class="editor-panel" role="tabpanel">
  <section>
    <div class="toolbar" id="grid-toolbar">
      <div id="filter-chips" class="filter-chips"></div>
      <label class="toolbar-label" for="filter-column">Filter</label>
      <select id="filter-column"><option value="">Column</option></select>
      <select id="filter-op">
        <option value="">Op</option>
        <option value="=">=</option>
        <option value="!=">!=</option>
        <option value=">">&gt;</option>
        <option value="<">&lt;</option>
        <option value=">=">&gt;=</option>
        <option value="<=">&lt;=</option>
        <option value="is null">is null</option>
        <option value="is not null">is not null</option>
      </select>
      <input id="filter-value" type="text" placeholder="Value" />
      <label class="toolbar-label" for="filter-search">Search</label>
      <input id="filter-search" type="text" placeholder="Search" title="Find in visible columns. This does not run the query." />
      <button id="apply-filter" type="button">Apply filter</button>
      <details id="column-picker">
        <summary>Select columns</summary>
        <div id="column-picker-body"></div>
      </details>
    </div>
    <div class="table-wrap editor-table"><table id="grid" tabindex="0"><thead></thead><tbody></tbody></table></div>
  </section>
    </div>
    <div id="panel-result" class="editor-panel" role="tabpanel" hidden>
      <p class="hint" id="result-empty">No query yet.</p>
  <section id="result" hidden>
    <div class="toolbar result-toolbar">
      <label id="result-label">Result</label>
      <button id="clear-result" class="quiet" type="button">Clear result</button>
      <button id="export-query" class="quiet" type="button" hidden>Export result</button>
    </div>
    <div class="table-wrap editor-table"><table id="result-grid" tabindex="0"><thead></thead><tbody></tbody></table></div>
    <p class="hint" id="result-footer"></p>
  </section>
    </div>
    <div id="panel-compare" class="editor-panel" role="tabpanel" hidden>
  <section id="compare">
    <label>Compare</label>
    <p class="hint" id="compare-empty">Open another dataset to compare.</p>
    <div class="row-actions" id="compare-controls" hidden>
      <select id="compare-peer"><option value="">Choose dataset</option></select>
      <select id="compare-column"><option value="">Key column</option></select>
      <button id="compare-run" type="button">Compare</button>
    </div>
    <ul class="diag" id="compare-diagnostics"></ul>
    <div id="compare-lists" hidden>
      <p class="hint">Only in this file</p>
      <ul id="compare-only-left"></ul>
      <p class="hint">Only in the other file</p>
      <ul id="compare-only-right"></ul>
      <p class="hint">Changed</p>
      <ul id="compare-changed"></ul>
    </div>
  </section>
    </div>
    <div id="panel-profile" class="editor-panel" role="tabpanel" hidden>
  <section id="profile">
    <label>Profile</label>
    <p class="hint" id="profile-caption">These figures are from the describe sample, not the file.</p>
    <div class="table-wrap schema-wrap">
      <table id="profile-table"><thead><tr>
        <th>Column</th><th>Type</th><th>Sample size</th><th>null</th><th>missing</th><th>Distinct</th><th>Min</th><th>Max</th>
      </tr></thead><tbody></tbody></table>
    </div>
  </section>
    </div>
    <div id="panel-changes" class="editor-panel" role="tabpanel" hidden>
  <section id="changes">
    <label>Changes</label>
    <p class="hint" id="changes-empty">No pending change.</p>
    <pre class="diff" id="changes-diff" hidden></pre>
  </section>
    </div>
  </div>
  <p id="editor-footer" class="editor-footer"></p>
  <div class="row-actions" id="page-actions">
    <button id="page-prev" type="button" hidden>Previous page</button>
    <button id="page-next" type="button" hidden>Next page</button>
  </div>
  </div>
  <section id="inspector" hidden>
    <div class="row-actions">
      <label>Cell inspector</label>
      <button id="inspector-toggle" type="button">Show inspector</button>
    </div>
    <div id="inspector-body">
      <dl class="inspect-fields">
        <dt>Column</dt><dd id="inspect-column">—</dd>
        <dt>Type</dt><dd id="inspect-type">—</dd>
        <dt>Raw value</dt><dd id="inspect-raw">—</dd>
      </dl>
      <p class="hint" id="inspect-detail"></p>
      <button id="copy-cell" type="button">Copy value</button>
    </div>
  </section>
  </div>
  <script nonce="${escapeHtml(nonce)}" src="${escapeHtml(String(scriptUri))}"></script>
</body>
</html>`;
}

function panelHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  nonce: string,
  title: string,
): string {
  return editorPanelHtml(webview, extensionUri, nonce, title);
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

/** The dataset surface a command may copy from. */
export interface DatasetQuerySurface {
  requestDqlText(): Promise<string>;
  datasetPath(): string | undefined;
  columnSnapshot(): ColumnMeta[];
}

let activeEditorSession: DatasetViewSession | undefined;

export function activeDatasetEditorSession(): DatasetQuerySurface | undefined {
  if (activeEditorSession?.isEditorActive()) return activeEditorSession;
  return undefined;
}

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
      vscode.Disposable.from(
        panel.onDidDispose(() => {
          session.dispose();
          viewSessions.delete(panel);
          panelSubscriptions.delete(panel);
        }),
        panel.onDidChangeViewState((event) => {
          session.setEditorActive(event.webviewPanel.active);
        }),
      ),
    );
  }
  session.setEditorActive(panel.active);
  return session;
}

const panelSubscriptions = new WeakMap<vscode.WebviewPanel, vscode.Disposable>();

const editorSessions = new Set<DatasetViewSession>();
const pendingReveal = new Map<string, "data" | "result">();
const pendingExternalResult = new Map<
  string,
  { result: QueryResult; elapsedMs?: number; dql?: string }
>();

class DatasetViewSession {
  private readonly nonce: string;
  private currentFilePath: string | undefined;
  private datasetId: string | undefined;
  private columns: ColumnMeta[] = [];
  private previewStyles = new Map<string, { pill: boolean; alignEnd: boolean }>();
  private editorActive = false;
  private dqlRequestSeq = 0;
  private readonly dqlWaiters = new Map<
    string,
    { resolve: (dql: string) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private fileWatcher: vscode.FileSystemWatcher | undefined;
  private webviewReady = false;
  private pendingPosts: HostToWebviewMessage[] = [];
  private undelivered: { message: HostToWebviewMessage; attempts: number }[] = [];
  private undeliveredTimer: ReturnType<typeof setTimeout> | undefined;
  private loadGeneration = 0;
  private loadInFlight = false;
  private inspectSeq = 0;
  private lastSessionPayload:
    | Extract<HostToWebviewMessage, { type: "session" }>
    | undefined;
  private readonly peersSub: vscode.Disposable;

  constructor(
    private readonly surface: DatasetViewSurface,
    private readonly options: MountDatasetViewOptions,
  ) {
    this.nonce = createWebviewNonce();
    editorSessions.add(this);
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
    this.peersSub = options.engine.onSessionsChanged(() => {
      this.postComparePeers();
    });
  }

  datasetPath(): string | undefined {
    return this.currentFilePath;
  }

  columnSnapshot(): ColumnMeta[] {
    return this.columns;
  }

  isEditorActive(): boolean {
    return this.editorActive;
  }

  setEditorActive(active: boolean): void {
    this.editorActive = active;
    if (active) {
      activeEditorSession = this;
    } else if (activeEditorSession === this) {
      activeEditorSession = undefined;
    }
  }

  showTab(tab: "data" | "result"): void {
    this.post({ type: "showEditorTab", tab });
  }

  async copyText(text: string): Promise<void> {
    await vscode.env.clipboard.writeText(text);
  }

  async proposeCellEdit(rowIndex: number, column: string, newRaw: string): Promise<void> {
    try {
      const preview = await this.engine.proposeEdit(this.requireDatasetId(), rowIndex, column, newRaw);
      this.post({ type: "editPreview", preview });
    } catch (err) {
      this.reportError(err);
    }
  }

  async applyCellEdit(rowIndex: number, column: string, newRaw: string): Promise<void> {
    this.holdOwnWrite();
    try {
      const applied = await this.engine.applyEdit(this.requireDatasetId(), rowIndex, column, newRaw);
      if (applied.editPreview.unifiedDiff) {
        this.post({ type: "editPreview", preview: applied.editPreview });
      }
      if (!applied.written) return;
      void vscode.window.showInformationMessage(
        `Saved ${applied.editPreview.column} @ row ${applied.editPreview.rowIndex}`,
      );
      this.holdOwnWrite();
      await this.loadDataset(applied.path);
    } catch (err) {
      this.reportError(err);
    }
  }

  requestDqlText(): Promise<string> {
    const requestId = `dql-${++this.dqlRequestSeq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.dqlWaiters.delete(requestId);
        reject(new Error("The dataset view did not return its query text"));
      }, 2000);
      this.dqlWaiters.set(requestId, { resolve, timer });
      this.post({ type: "requestDql", requestId });
    });
  }

  dispose(): void {
    editorSessions.delete(this);
    this.setEditorActive(false);
    for (const waiter of this.dqlWaiters.values()) clearTimeout(waiter.timer);
    this.dqlWaiters.clear();
    if (this.undeliveredTimer !== undefined) {
      clearTimeout(this.undeliveredTimer);
      this.undeliveredTimer = undefined;
    }
    this.fileWatcher?.dispose();
    this.fileWatcher = undefined;
    this.peersSub.dispose();
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

  private requireDatasetId(): string {
    if (!this.datasetId) {
      throw {
        code: "no-dataset",
        severity: "error",
        message: "Open a dataset first",
      } satisfies Diagnostic;
    }
    return this.datasetId;
  }

  private reportError(err: unknown): void {
    this.post({ type: "error", message: errorMessage(err) });
  }

  private postComparePeers(): void {
    if (!this.datasetId) return;
    const peers = this.engine
      .listOpenSessions()
      .filter((session) => session.datasetId !== this.datasetId)
      .map((session) => ({
        datasetId: session.datasetId,
        label: path.basename(session.filePath),
        columns: this.engine.columnNames(session.datasetId),
      }));
    this.post({ type: "comparePeers", peers });
  }

  private postCompareResult(result: KeyDiffResult): void {
    this.post({
      type: "compareResult",
      completion: result.completion,
      diagnostics: result.diagnostics,
      onlyLeft: result.onlyLeft.map((key) => formatCell(key)),
      onlyRight: result.onlyRight.map((key) => formatCell(key)),
      changed: result.changed.map((row) => ({
        key: formatCell(row.key),
        columns: row.columns,
      })),
    });
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

  private postQueryLoaded(dql: string, columns: readonly string[]): void {
    const chips = readToolbarChips(dql, columns);
    this.post({
      type: "queryLoaded",
      dql,
      chipFilters: chips.filters,
      chipSearch: chips.search,
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

  private suppressStaleUntil = 0;

  /** Our own write is not an external change. The watcher stays quiet through the reload. */
  private holdOwnWrite(): void {
    this.suppressStaleUntil = Date.now() + 2000;
  }

  private postRevert(): void {
    const available = this.currentFilePath
      ? this.engine.hasRevert(this.currentFilePath)
      : false;
    this.post({ type: "revertState", available });
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
      if (!acceptStaleEvents || Date.now() < this.suppressStaleUntil) return;
      if (this.currentFilePath) this.engine.dropRevert(this.currentFilePath);
      this.postRevert();
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
    this.loadInFlight = true;
    logInfo(`Open dataset requested: ${filePath} (gen=${generation})`);
    const job = this.options.jobs.begin({
      kind: "preview",
      filePath,
      fileName: path.basename(filePath),
    });
    const started = Date.now();
    try {
      const session = await this.engine.openDataset(filePath);
      const elapsedMs = Date.now() - started;
      this.options.jobs.finish(job.id, {
        outcome: activityOutcome("preview", session.preview.completion, false),
        elapsedMs,
      });
      if (token?.isCancellationRequested || generation !== this.loadGeneration) {
        return false;
      }
      this.datasetId = session.handle.datasetId;
      this.columns = session.handle.columns;
      this.previewStyles = rememberStyles(session.handle.columns, session.preview.rows);
      noteEditorActivity(
        filePath,
        activityText(
          "preview",
          activityOutcome("preview", session.preview.completion, false),
          elapsedMs,
        ),
      );
      this.watchSourceFile(filePath);
      this.surface.setTitle(filePath.split(/[/\\]/).pop() ?? "Data Pilot");
      logInfo(`Posting dataset session (gen=${generation})`);
      this.postComparePeers();
      this.post({
        type: "session",
        handle: session.handle,
        describe: serializeDescribe(session.handle),
        ingestDiagnostics: mergeIngestDiagnostics(
          session.diagnostics,
          session.preview.diagnostics,
        ),
        preview: serializeGrid(
          "preview",
          session.preview,
          session.handle.columns,
          elapsedMs,
          this.previewStyles,
        ),
        datasetColor: datasetColorToken(filePath),
      });
      this.consumePendingResult(filePath);
      this.postRevert();
      this.consumePendingReveal(filePath);
      return true;
    } catch (err) {
      this.options.jobs.finish(job.id, {
        outcome: activityOutcome("preview", undefined, true),
        elapsedMs: Date.now() - started,
      });
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
      this.post({ type: "error", message });
      logError(`Open dataset failed: ${message}`);
      void vscode.window.showErrorMessage(`Data Pilot: ${message}`);
      if (generation === this.loadGeneration) {
        pendingExternalResult.delete(path.resolve(filePath));
        pendingReveal.delete(path.resolve(filePath));
      }
      return false;
    } finally {
      if (generation === this.loadGeneration) this.loadInFlight = false;
    }
  }

  private async loadPreviewPage(offset: number): Promise<void> {
    if (!this.datasetId || !this.currentFilePath) {
      this.reportError({ message: "Open a dataset first" });
      return;
    }
    const filePath = this.currentFilePath;
    const generation = this.loadGeneration;
    const job = this.options.jobs.begin({
      kind: "preview",
      filePath,
      fileName: path.basename(filePath),
    });
    const started = Date.now();
    try {
      const result = await this.engine.fetchPage(this.datasetId, offset);
      const elapsedMs = Date.now() - started;
      this.options.jobs.finish(job.id, {
        outcome: activityOutcome("preview", result.completion, result.completion === "error"),
        elapsedMs,
      });
      if (generation !== this.loadGeneration) return;
      this.previewStyles = rememberStyles(this.columns, result.rows);
      this.post({
        type: "previewPage",
        offset,
        preview: serializeGrid("preview", result, this.columns, elapsedMs, this.previewStyles),
      });
      noteEditorActivity(
        filePath,
        activityText(
          "preview",
          activityOutcome("preview", result.completion, result.completion === "error"),
          elapsedMs,
        ),
      );
    } catch (err) {
      this.options.jobs.finish(job.id, {
        outcome: activityOutcome("preview", undefined, true),
        elapsedMs: Date.now() - started,
      });
      if (generation === this.loadGeneration) this.reportError(err);
    }
  }

  private async loadQueryPage(dql: string, offset: number): Promise<void> {
    const blocked = assertOpAllowed(
      { trustMode: vscode.workspace.isTrusted ? "trusted" : "untrusted-limited" },
      "executeQuery",
    );
    if (blocked) {
      this.reportError(blocked);
      return;
    }
    let stages: string[] = [];
    try {
      stages = parseDql(dql).stages.map((stage) => stage.kind);
    } catch (err) {
      this.reportError(err);
      return;
    }
    if (!queryStagesPage(stages)) {
      this.reportError({ message: "This query does not have another page" });
      return;
    }
    const filePath = this.currentFilePath;
    if (!filePath || !this.datasetId) {
      this.reportError({ message: "Open a dataset first" });
      return;
    }
    const generation = this.loadGeneration;
    const queryName = savedQueryDisplayName(this.savedQueryStore.list(), dql, path.resolve(filePath));
    const job = this.options.jobs.begin({
      kind: "query",
      filePath,
      fileName: path.basename(filePath),
      dql,
      ...(queryName ? { name: queryName } : {}),
    });
    this.post({ type: "queryState", running: true });
    const started = Date.now();
    try {
      const result = await this.engine.executeQuery(this.datasetId, dql, offset);
      const elapsedMs = Date.now() - started;
      this.options.jobs.finish(job.id, {
        outcome: activityOutcome("query", result.completion, result.completion === "error"),
        elapsedMs,
        cancelled: result.completion === "cancelled",
      });
      if (generation !== this.loadGeneration) return;
      noteEditorActivity(
        filePath,
        activityText("query", activityOutcome("query", result.completion, result.completion === "error"), elapsedMs),
      );
      this.post({
        type: "queryResult",
        result: serializeGrid("query", result, this.columns, elapsedMs, this.previewStyles),
        diagnostics: result.diagnostics,
        elapsedMs,
        resultTitle: this.resultTitleFor(dql),
        offset,
      });
    } catch (err) {
      this.options.jobs.finish(job.id, {
        outcome: activityOutcome("query", undefined, true),
        elapsedMs: Date.now() - started,
      });
      if (generation === this.loadGeneration) this.reportError(err);
    } finally {
      if (generation === this.loadGeneration) this.post({ type: "queryState", running: false });
    }
  }

  isReadyForExternalResult(): boolean {
    return this.currentFilePath !== undefined && !this.loadInFlight;
  }

  paintExternalResult(result: QueryResult, elapsedMs?: number, dql?: string): void {
    this.post({
      type: "queryResult",
      result: serializeGrid("query", result, this.columns, elapsedMs, this.previewStyles),
      diagnostics: result.diagnostics,
      ...(elapsedMs !== undefined ? { elapsedMs } : {}),
      resultTitle: this.resultTitleFor(dql),
    });
  }

  private resultTitleFor(dql: string | undefined): string {
    const file = this.currentFilePath ? path.resolve(this.currentFilePath) : undefined;
    const saved = dql
      ? this.savedQueryStore
          .list()
          .find((row) => row.dql === dql && row.datasetPath === file)
      : undefined;
    return resultTabLabel(saved?.name, dql);
  }

  private consumePendingReveal(filePath: string): void {
    const key = path.resolve(filePath);
    const tab = pendingReveal.get(key);
    if (!tab) return;
    pendingReveal.delete(key);
    this.showTab(tab);
  }

  private consumePendingResult(filePath: string): void {
    const key = path.resolve(filePath);
    const pending = pendingExternalResult.get(key);
    if (!pending) return;
    pendingExternalResult.delete(key);
    this.paintExternalResult(pending.result, pending.elapsedMs, pending.dql);
  }

  private async onWebviewMessage(raw: unknown): Promise<void> {
    const msg = parseWebviewMessage(raw);
    if (!msg) {
      logError(`Ignored webview message: ${safePreview(raw)}`);
      return;
    }

    if (msg.type === "reportDql") {
      const waiter = this.dqlWaiters.get(msg.requestId);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      this.dqlWaiters.delete(msg.requestId);
      waiter.resolve(msg.dql);
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

    const boundDatasetId = (): string => {
      if (!this.datasetId) {
        throw {
          code: "no-dataset",
          severity: "error",
          message: "Open a dataset first",
        } satisfies Diagnostic;
      }
      return this.datasetId;
    };

    const showErr = (err: unknown): void => {
      this.reportError(err);
    };

    if (msg.type === "reopenDataset") {
      if (this.currentFilePath) {
        await this.loadDataset(this.currentFilePath);
      }
      return;
    }

    if (msg.type === "revertLastEdit") {
      if (!this.currentFilePath) return;
      this.holdOwnWrite();
      try {
        const reverted = await this.engine.revertLastEdit(this.currentFilePath);
        if (!reverted) {
          this.postRevert();
          return;
        }
        await this.loadDataset(this.currentFilePath);
      } catch (err) {
        showErr(err);
      }
      return;
    }

    if (msg.type === "cancelQuery") {
      this.options.jobs.cancelActive();
      await this.engine.cancelActiveQuery();
      this.post({ type: "queryState", running: false });
      return;
    }

    if (msg.type === "copyText") {
      await this.copyText(msg.text);
      return;
    }

    if (msg.type === "inspectorFocus") {
      this.inspectSeq += 1;
      return;
    }

    if (msg.type === "inspectCell") {
      const generation = this.loadGeneration;
      const seq = ++this.inspectSeq;
      try {
        const detail = await this.engine.inspectCell(boundDatasetId(), msg.rowIndex, msg.column);
        if (generation !== this.loadGeneration || seq !== this.inspectSeq) return;
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
      await this.proposeCellEdit(msg.rowIndex, msg.column, msg.newRaw);
      return;
    }

    if (msg.type === "applyEdit") {
      await this.applyCellEdit(msg.rowIndex, msg.column, msg.newRaw);
      return;
    }

    if (msg.type === "loadSavedQuery") {
      const found = this.savedQueryStore
        .list()
        .find((q) => q.savedAtMs === msg.savedAtMs);
      if (found) {
        this.postQueryLoaded(found.dql, []);
      }
      return;
    }

    if (msg.type === "saveQuery") {
      try {
        const plan = await this.engine.planQuery(boundDatasetId(), msg.dql);
        if (!planLooksRunnable(plan.diagnostics)) {
          this.post({
            type: "dqlPlan",
            ok: false,
            diagnostics: plan.diagnostics,
          });
          return;
        }
        const datasetId = boundDatasetId();
        const saved = await this.engine.saveQuery(datasetId, msg.dql);
        const datasetPath = this.engine
          .listOpenSessions()
          .find((session) => session.datasetId === datasetId)?.filePath;
        const withPath = rememberDatasetPath(saved, datasetPath);
        let named = withPath;
        if (savedQueryNeedsName(this.savedQueryStore.list(), withPath)) {
          const picked = await vscode.window.showInputBox({
            title: "Name this query",
            prompt: "Leave empty to keep the query text as the label.",
          });
          const trimmed = picked?.trim();
          if (trimmed) named = { ...withPath, name: trimmed };
        }
        const queries = this.savedQueryStore.append(named);
        this.post({ type: "savedQueries", queries });
        void vscode.window.showInformationMessage("Query saved to workspace state");
      } catch (err) {
        showErr(err);
      }
      return;
    }

    if (msg.type === "exportQuery") {
      try {
        const plan = await this.engine.planQuery(boundDatasetId(), msg.dql);
        if (!planLooksRunnable(plan.diagnostics)) {
          this.post({
            type: "dqlPlan",
            ok: false,
            diagnostics: plan.diagnostics,
          });
          return;
        }
        const artifact = await this.engine.exportQueryResult(
          boundDatasetId(),
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
        const chips = readToolbarChips(msg.dql, msg.columns ?? []);
        const plan = await this.engine.planQuery(boundDatasetId(), msg.dql);
        const ok = planLooksRunnable(plan.diagnostics);
        this.post({
          type: "dqlPlan",
          ok,
          dql: msg.dql,
          ...(plan.formatted !== undefined ? { formatted: plan.formatted } : {}),
          diagnostics: plan.diagnostics,
          chipFilters: chips.filters,
          chipSearch: chips.search,
        });
      } catch (err) {
        showErr(err);
      }
      return;
    }

    if (msg.type === "compareDatasets") {
      const leftId = this.datasetId;
      if (!leftId) return;
      const blocked = assertOpAllowed(
        { trustMode: vscode.workspace.isTrusted ? "trusted" : "untrusted-limited" },
        "compareDatasets",
      );
      if (blocked) {
        this.postCompareResult({
          completion: "error",
          diagnostics: [blocked],
          onlyLeft: [],
          onlyRight: [],
          changed: [],
        });
        return;
      }
      try {
        const result = await this.engine.compareDatasets(leftId, msg.rightDatasetId, msg.column);
        this.postCompareResult(result);
      } catch (err) {
        const message =
          typeof err === "object" && err !== null && "message" in err
            ? String((err as { message: unknown }).message)
            : String(err);
        this.postCompareResult({
          completion: "error",
          diagnostics: [{ code: "compare-failed", severity: "error", message }],
          onlyLeft: [],
          onlyRight: [],
          changed: [],
        });
      }
      return;
    }

    if (msg.type === "openQueryInEditor") {
      await vscode.commands.executeCommand("dataPilot.openQueryInEditor");
      return;
    }

    if (msg.type === "applyFilter") {
      if (msg.keepDql) {
        const next = msg.dropSearch
          ? dropToolbarChip(msg.keepDql, msg.columns, { search: true })
          : msg.dropFilter !== undefined
            ? dropToolbarChip(msg.keepDql, msg.columns, { filter: msg.dropFilter })
            : null;
        if (next === null) return;
        this.postQueryLoaded(next, msg.columns);
        return;
      }
      const dql = filterToDql(msg);
      if (!dql) {
        if (!msg.project) this.postQueryLoaded("", msg.columns);
        return;
      }
      try {
        parseDql(dql);
      } catch (err) {
        if (err instanceof ParseError) {
          this.post({
            type: "dqlPlan",
            ok: false,
            diagnostics: [
              {
                code: err.code,
                severity: "error",
                message: err.message,
                range: err.span,
              },
            ],
          });
          return;
        }
        showErr(err);
        return;
      }
      this.postQueryLoaded(dql, msg.columns);
      return;
    }

    if (msg.type === "changePage") {
      if (msg.surface === "preview") await this.loadPreviewPage(msg.offset);
      else if (msg.dql) await this.loadQueryPage(msg.dql, msg.offset);
      return;
    }

    if (msg.type === "runQuery") {
      const generation = this.loadGeneration;
      try {
        const plan = await this.engine.planQuery(boundDatasetId(), msg.dql);
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

      const filePath = this.currentFilePath;
      const queryName = filePath
        ? savedQueryDisplayName(this.savedQueryStore.list(), msg.dql, path.resolve(filePath))
        : undefined;
      const job = filePath
        ? this.options.jobs.begin({
            kind: "query",
            filePath,
            fileName: path.basename(filePath),
            dql: msg.dql,
            ...(queryName ? { name: queryName } : {}),
          })
        : undefined;
      this.post({ type: "queryState", running: true });
      const started = Date.now();
      try {
        const result = await this.engine.executeQuery(boundDatasetId(), msg.dql);
        const elapsedMs = Date.now() - started;
        if (job) {
          this.options.jobs.finish(job.id, {
            outcome: activityOutcome("query", result.completion, false),
            elapsedMs,
            cancelled: result.completion === "cancelled",
          });
        }
        if (generation !== this.loadGeneration) return;
        if (filePath) {
          noteEditorActivity(
            filePath,
            activityText("query", activityOutcome("query", result.completion, false), elapsedMs),
          );
        }
        this.post({
          type: "queryResult",
          result: serializeGrid("query", result, this.columns, elapsedMs, this.previewStyles),
          diagnostics: result.diagnostics,
          elapsedMs,
          resultTitle: this.resultTitleFor(msg.dql),
        });
      } catch (err) {
        if (job) {
          this.options.jobs.finish(job.id, {
            outcome: activityOutcome("query", undefined, true),
            elapsedMs: Date.now() - started,
          });
        }
        if (filePath) {
          noteEditorActivity(filePath, activityText("query", "failed", Date.now() - started));
        }
        showErr(err);
      } finally {
        this.post({ type: "queryState", running: false });
      }
    }
  }
}

function errorMessage(err: unknown): string {
  return typeof err === "object" && err !== null && "message" in err
    ? String((err as { message: unknown }).message)
    : String(err);
}

function editorFor(filePath: string): DatasetViewSession | undefined {
  const key = path.resolve(filePath);
  for (const session of editorSessions) {
    const current = session.datasetPath();
    if (current && path.resolve(current) === key) return session;
  }
  return undefined;
}

/** Ask an open editor to show Data or Result. Result stays put when that result is gone. */
export function revealDatasetTab(filePath: string, tab: "data" | "result"): void {
  const key = path.resolve(filePath);
  const session = editorFor(filePath);
  if (session) {
    pendingReveal.delete(key);
    session.showTab(tab);
    return;
  }
  pendingReveal.set(key, tab);
}

/** Resolved paths of dataset editors that already have a file open. */
export function openEditorPaths(): string[] {
  const paths: string[] = [];
  for (const session of editorSessions) {
    const filePath = session.datasetPath();
    if (filePath) paths.push(path.resolve(filePath));
  }
  return paths;
}

/** Paint Result on the open editor for this path. False when that editor is not ready. */
export function paintOpenEditorResult(
  filePath: string,
  result: QueryResult,
  elapsedMs?: number,
  dql?: string,
): boolean {
  const session = editorFor(filePath);
  if (!session?.isReadyForExternalResult()) return false;
  session.paintExternalResult(result, elapsedMs, dql);
  return true;
}

/** Open the dataset editor and paint Result after its preview session is posted. */
export async function openEditorForResult(
  filePath: string,
  result: QueryResult,
  elapsedMs?: number,
  dql?: string,
): Promise<void> {
  const key = path.resolve(filePath);
  const existing = editorFor(filePath);
  if (existing?.isReadyForExternalResult()) {
    existing.paintExternalResult(result, elapsedMs, dql);
    return;
  }
  const pending = {
    result,
    ...(elapsedMs !== undefined ? { elapsedMs } : {}),
    ...(dql !== undefined ? { dql } : {}),
  };
  pendingExternalResult.set(key, pending);
  try {
    await vscode.commands.executeCommand(
      "vscode.openWith",
      vscode.Uri.file(filePath),
      DATA_PILOT_VIEW_TYPE,
    );
  } catch (err) {
    if (pendingExternalResult.get(key) === pending) pendingExternalResult.delete(key);
    throw err;
  }
  const session = editorFor(filePath);
  if (session?.isReadyForExternalResult() && pendingExternalResult.get(key) === pending) {
    pendingExternalResult.delete(key);
    session.paintExternalResult(result, elapsedMs, dql);
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
