import * as path from "node:path";
import * as vscode from "vscode";
import type { OpenDatasetSession } from "./dataset-sessions";
import type { ExtensionEngineHost } from "./engine-host";

/** Activity Bar tree of datasets the host already has open. */
export class DatasetTreeProvider
  implements vscode.TreeDataProvider<OpenDatasetSession>, vscode.Disposable
{
  private readonly change = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.change.event;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly engine: ExtensionEngineHost) {
    this.subscription = engine.onSessionsChanged(() => {
      this.change.fire();
    });
  }

  dispose(): void {
    this.subscription.dispose();
    this.change.dispose();
  }

  getTreeItem(session: OpenDatasetSession): vscode.TreeItem {
    const item = new vscode.TreeItem(
      path.basename(session.filePath),
      vscode.TreeItemCollapsibleState.None,
    );
    item.id = session.datasetId;
    item.description = session.datasetId;
    item.tooltip = `${session.filePath}\n${session.datasetId}`;
    item.iconPath = new vscode.ThemeIcon("table");
    item.command = {
      command: "dataPilot.openDatasetCustomEditor",
      title: "Open dataset",
      arguments: [vscode.Uri.file(session.filePath)],
    };
    return item;
  }

  getChildren(element?: OpenDatasetSession): OpenDatasetSession[] {
    if (element) return [];
    return this.engine.listOpenSessions();
  }
}
