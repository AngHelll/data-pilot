import * as vscode from "vscode";
import { isDatasetUri } from "./dataset-uri";
import { DATA_PILOT_VIEW_TYPE, ensureDatasetViewSession } from "./webview/dataset-panel";
import type { ExtensionEngineHost } from "./engine-host";
import type { SavedQueryStore } from "./saved-query-store";

export { DATA_PILOT_VIEW_TYPE } from "./webview/dataset-panel";

interface DatasetCustomDocument extends vscode.CustomDocument {
  readonly uri: vscode.Uri;
}

export class DatasetCustomEditorProvider
  implements vscode.CustomReadonlyEditorProvider<DatasetCustomDocument>
{
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly engine: ExtensionEngineHost,
    private readonly savedQueries: SavedQueryStore,
  ) {}

  openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken,
  ): DatasetCustomDocument {
    if (!isDatasetUri(uri)) {
      throw new Error("Data Pilot editor supports CSV and JSONL files only");
    }
    return {
      uri,
      dispose: () => undefined,
    };
  }

  async resolveCustomEditor(
    document: DatasetCustomDocument,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken,
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    const title = document.uri.fsPath.split(/[/\\]/).pop() ?? "Data Pilot";
    webviewPanel.title = title;

    const session = ensureDatasetViewSession(webviewPanel, {
      engine: this.engine,
      savedQueryStore: this.savedQueries,
      extensionUri: this.context.extensionUri,
      title,
      layout: "editor",
    });

    await session.loadDataset(document.uri.fsPath, token);
  }
}
