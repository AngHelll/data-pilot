import * as vscode from "vscode";
import {
  DATASET_INDEX_EXCLUDE,
  DATASET_INDEX_INCLUDE,
  DATASET_INDEX_LIMIT,
  datasetCatalog,
  datasetIndexLimitLabel,
  type DatasetCatalogEntry,
} from "./dataset-catalog";
import { datasetTabPaths } from "./dataset-uri";
import { datasetTreePresentation } from "./dataset-tree-presentation";
import { datasetFormatIcon, datasetRowColor, datasetRowState } from "./dataset-open-plan";
import type { ExtensionEngineHost } from "./engine-host";
import { logError } from "./log";

/** Activity Bar list of supported files. Showing it does not open the engine. */
export class DatasetTreeProvider
  implements vscode.TreeDataProvider<DatasetCatalogEntry>, vscode.Disposable
{
  private readonly change = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.change.event;
  private readonly subscriptions: vscode.Disposable[] = [];
  private rows: DatasetCatalogEntry[] = [];
  private workspacePaths: string[] = [];
  private hitLimit = false;
  private generation = 0;
  private viewVisible = false;

  constructor(private readonly engine: ExtensionEngineHost) {}

  attach(view: vscode.TreeView<DatasetCatalogEntry>): void {
    this.viewVisible = view.visible;
    const watcher = vscode.workspace.createFileSystemWatcher(DATASET_INDEX_INCLUDE);
    this.subscriptions.push(
      view.onDidChangeVisibility((event) => {
        this.viewVisible = event.visible;
        if (event.visible) void this.refreshWorkspace();
      }),
      vscode.window.tabGroups.onDidChangeTabs(() => {
        if (this.viewVisible) this.publish();
      }),
      this.engine.onSessionsChanged(() => {
        this.change.fire();
      }),
      watcher,
      watcher.onDidCreate(() => {
        if (this.viewVisible) void this.refreshWorkspace();
      }),
      watcher.onDidDelete(() => {
        if (this.viewVisible) void this.refreshWorkspace();
      }),
    );
    if (view.visible) void this.refreshWorkspace();
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
    this.subscriptions.length = 0;
    this.change.dispose();
  }

  getTreeItem(entry: DatasetCatalogEntry): vscode.TreeItem {
    if (entry.kind === "limit") {
      const item = new vscode.TreeItem(
        datasetIndexLimitLabel(),
        vscode.TreeItemCollapsibleState.None,
      );
      item.id = "dataset-index-limit";
      item.contextValue = "dataset.limit";
      item.tooltip = "Data Pilot lists 200 files. The rest stay out of this view.";
      return item;
    }

    const session = this.engine
      .listOpenSessions()
      .find((open) => open.filePath === entry.filePath);
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(entry.filePath));
    const shown = datasetTreePresentation(
      entry.filePath,
      session?.datasetId,
      folder?.uri.fsPath,
    );
    const item = new vscode.TreeItem(shown.label, vscode.TreeItemCollapsibleState.None);
    item.id = entry.filePath;
    if (shown.description) item.description = shown.description;
    item.tooltip = shown.tooltip;
    item.resourceUri = vscode.Uri.file(entry.filePath);
    item.contextValue = "dataset.file";
    const state = datasetRowState({
      open: session !== undefined,
      diagnostics: this.engine.diagnosticsFor(entry.filePath),
    });
    const color = datasetRowColor(state);
    item.iconPath = new vscode.ThemeIcon(
      datasetFormatIcon(entry.filePath),
      color ? new vscode.ThemeColor(color) : undefined,
    );
    item.command = {
      command: "dataPilot.openDatasetCustomEditor",
      title: "Open dataset",
      arguments: [vscode.Uri.file(entry.filePath)],
    };
    return item;
  }

  getChildren(element?: DatasetCatalogEntry): DatasetCatalogEntry[] {
    if (element) return [];
    return this.rows;
  }

  private async refreshWorkspace(): Promise<void> {
    const generation = ++this.generation;
    let found: vscode.Uri[];
    try {
      found = await vscode.workspace.findFiles(
        DATASET_INDEX_INCLUDE,
        DATASET_INDEX_EXCLUDE,
        DATASET_INDEX_LIMIT,
      );
    } catch (err) {
      logError(
        "Could not list workspace datasets",
        err instanceof Error ? err.message : String(err),
      );
      return;
    }
    if (generation !== this.generation) return;
    this.workspacePaths = found.map((uri) => uri.fsPath);
    this.hitLimit = found.length >= DATASET_INDEX_LIMIT;
    this.publish();
  }

  private publish(): void {
    this.rows = datasetCatalog({
      workspacePaths: this.workspacePaths,
      tabPaths: datasetTabPaths(openTabFilePaths()),
      hitLimit: this.hitLimit,
    });
    this.change.fire();
  }
}

function openTabFilePaths(): string[] {
  const paths: string[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const uri = tabFileUri(tab);
      if (uri) paths.push(uri.fsPath);
    }
  }
  return paths;
}

function tabFileUri(tab: vscode.Tab): vscode.Uri | undefined {
  const input = tab.input;
  if (input instanceof vscode.TabInputText) return input.uri;
  if (input instanceof vscode.TabInputCustom) return input.uri;
  return undefined;
}
