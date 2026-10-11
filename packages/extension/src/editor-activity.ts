import * as path from "node:path";
import * as vscode from "vscode";

const DATASET_VIEW_TYPE = "dataPilot.dataset";

let fileItem: vscode.StatusBarItem | undefined;
let opItem: vscode.StatusBarItem | undefined;
let linkedDataset: ((documentUri: string) => string | undefined) | undefined;
const lastOp = new Map<string, string>();

/** Two status-bar items. The last operation stays in memory for this window. */
export function installEditorActivity(
  context: vscode.ExtensionContext,
  lookup: (documentUri: string) => string | undefined,
): void {
  linkedDataset = lookup;
  fileItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  opItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 80);
  context.subscriptions.push(
    fileItem,
    opItem,
    vscode.window.onDidChangeActiveTextEditor(() => renderEditorActivity()),
    vscode.window.tabGroups.onDidChangeTabs(() => renderEditorActivity()),
  );
  renderEditorActivity();
}

export function noteEditorActivity(filePath: string, text: string): void {
  lastOp.set(path.resolve(filePath), text);
  renderEditorActivity();
}

export function renderEditorActivity(): void {
  if (!fileItem || !opItem) return;
  const file = activeDatasetPath();
  if (!file) {
    fileItem.hide();
    opItem.hide();
    return;
  }
  fileItem.text = `$(database) ${path.basename(file)}`;
  fileItem.tooltip = file;
  fileItem.show();
  const op = lastOp.get(path.resolve(file));
  if (!op) {
    opItem.hide();
    return;
  }
  opItem.text = op;
  opItem.tooltip = op;
  opItem.show();
}

function activeDatasetPath(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor?.document.languageId === "data-pilot-dql") {
    return linkedDataset?.(editor.document.uri.toString());
  }
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input instanceof vscode.TabInputCustom && input.viewType === DATASET_VIEW_TYPE) {
    return input.uri.fsPath;
  }
  return undefined;
}
