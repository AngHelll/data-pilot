import * as vscode from "vscode";
import type { SavedQuery } from "@data-pilot/contracts";
import { SavedQueryStore } from "./saved-query-store";
import { savedQueryPresentation } from "./saved-query-tree";

/** Activity Bar tree of queries already saved in this workspace. Does not scan the disk. */
export class SavedQueryTreeProvider
  implements vscode.TreeDataProvider<SavedQuery>, vscode.Disposable
{
  private readonly change = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.change.event;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly store: SavedQueryStore) {
    this.subscription = store.onDidChange(() => {
      this.change.fire();
    });
  }

  dispose(): void {
    this.subscription.dispose();
    this.change.dispose();
  }

  getTreeItem(query: SavedQuery): vscode.TreeItem {
    const text = savedQueryPresentation(query);
    const item = new vscode.TreeItem(text.label, vscode.TreeItemCollapsibleState.None);
    item.id = `${query.savedAtMs}:${query.datasetPath ?? ""}:${query.dql}`;
    item.description = text.description;
    if (!query.datasetPath) item.contextValue = "savedQuery.noDataset";
    item.tooltip = text.tooltip;
    item.iconPath = new vscode.ThemeIcon("search");
    item.command = {
      command: "dataPilot.openSavedQuery",
      title: "Open saved query",
      arguments: [query],
    };
    return item;
  }

  getChildren(element?: SavedQuery): SavedQuery[] {
    if (element) return [];
    return this.store.list();
  }
}
