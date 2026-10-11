import * as vscode from "vscode";
import { hostJobCancellable, hostJobPresentation, type HostJob, type HostJobLog } from "./host-jobs";

export class HostJobTreeProvider implements vscode.TreeDataProvider<HostJob>, vscode.Disposable {
  private readonly change = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.change.event;
  private readonly unsubscribe: () => void;

  constructor(private readonly jobs: HostJobLog) {
    this.unsubscribe = jobs.subscribe(() => {
      this.change.fire();
    });
  }

  dispose(): void {
    this.unsubscribe();
    this.change.dispose();
  }

  getTreeItem(job: HostJob): vscode.TreeItem {
    const text = hostJobPresentation(job);
    const item = new vscode.TreeItem(text.label, vscode.TreeItemCollapsibleState.None);
    item.id = job.id;
    item.description = text.description;
    item.tooltip = text.tooltip;
    item.contextValue = hostJobCancellable(job, this.jobs.activeQueryJobId())
      ? "hostJob.cancellable"
      : "hostJob";
    item.iconPath = new vscode.ThemeIcon(job.kind === "preview" ? "eye" : "play");
    item.command = {
      command: "dataPilot.openHostJob",
      title: "Open",
      arguments: [job],
    };
    return item;
  }

  getChildren(element?: HostJob): HostJob[] {
    if (element) return [];
    return [...this.jobs.list()];
  }
}
