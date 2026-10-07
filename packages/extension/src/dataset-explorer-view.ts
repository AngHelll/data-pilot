import * as vscode from "vscode";
import type { ExtensionEngineHost } from "./engine-host";
import { isDatasetUri } from "./dataset-uri";
import { ensureExplorerViewSession } from "./webview/dataset-panel";
import type { SavedQueryStore } from "./saved-query-store";

/** Explorer sidebar webview — Rainbow CSV-style: keep the text editor, preview in the side panel. */
export const DATA_PILOT_EXPLORER_VIEW_ID = "dataPilot.explorer";

export class DatasetExplorerWebviewProvider implements vscode.WebviewViewProvider {
  private session: ReturnType<typeof ensureExplorerViewSession> | undefined;
  /** Set while `loadDataset` is revealing the view so resolve does not open a second time. */
  private pendingPath: string | undefined;
  private loadedPath: string | undefined;
  private inflightPath: string | undefined;
  private inflight: Promise<void> | undefined;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly engine: ExtensionEngineHost,
    private readonly savedQueries: SavedQueryStore,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    this.session = ensureExplorerViewSession(webviewView, {
      engine: this.engine,
      savedQueryStore: this.savedQueries,
      extensionUri: this.context.extensionUri,
      title: "Data Pilot",
    });

    webviewView.onDidDispose(() => {
      this.session = undefined;
      this.loadedPath = undefined;
      this.inflight = undefined;
      this.inflightPath = undefined;
    });

    webviewView.onDidChangeVisibility(() => {
      if (!webviewView.visible) return;
      this.session?.onSurfaceVisible();
      this.syncFromActiveEditor();
    });

    // Caller of `loadDataset` is awaiting reveal and will open the file once.
    if (this.pendingPath) return;

    const uri = vscode.window.activeTextEditor?.document.uri;
    if (uri && uri.scheme === "file" && isDatasetUri(uri)) {
      void this.loadDataset(uri.fsPath);
      return;
    }
    this.session.showIdle();
  }

  hasSession(): boolean {
    return this.session !== undefined;
  }

  async reveal(): Promise<void> {
    await vscode.commands.executeCommand(`${DATA_PILOT_EXPLORER_VIEW_ID}.focus`);
  }

  async loadDataset(filePath: string, options?: { force?: boolean }): Promise<void> {
    const force = options?.force === true;
    if (!force && this.inflight && this.inflightPath === filePath) {
      return this.inflight;
    }
    if (!force && !this.inflight && this.session && this.loadedPath === filePath) {
      return;
    }

    const run = this.chain.then(() => this.performLoad(filePath, force));
    this.inflight = run;
    this.inflightPath = filePath;
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    try {
      await run;
    } finally {
      if (this.inflight === run) {
        this.inflight = undefined;
        this.inflightPath = undefined;
      }
    }
  }

  private async performLoad(filePath: string, force: boolean): Promise<void> {
    if (!this.session) {
      this.pendingPath = filePath;
      await this.reveal();
      this.pendingPath = undefined;
    }
    const session = this.session;
    if (!session) return;
    if (!force && this.loadedPath === filePath) return;
    const opened = await session.loadDataset(filePath);
    if (opened) this.loadedPath = filePath;
  }

  syncFromActiveEditor(editor = vscode.window.activeTextEditor): void {
    const uri = editor?.document.uri;
    if (!uri || uri.scheme !== "file" || !isDatasetUri(uri)) {
      return;
    }
    void this.loadDataset(uri.fsPath);
  }
}
