import * as vscode from "vscode";
import { assertOpAllowed } from "@data-pilot/core";
import type { ExtensionEngineHost } from "./engine-host";
import { workspaceTrustMode } from "./engine-host";
import { isDatasetUri } from "./dataset-uri";
import type { SavedQueryStore } from "./saved-query-store";
import { DATA_PILOT_VIEW_TYPE } from "./dataset-custom-editor";

export async function openDatasetUri(
  _engine: ExtensionEngineHost,
  _context: vscode.ExtensionContext,
  _savedQueries: SavedQueryStore,
  uri: vscode.Uri,
): Promise<void> {
  const blocked = assertOpAllowed({ trustMode: workspaceTrustMode() }, "openDataset");
  if (blocked) {
    void vscode.window.showErrorMessage(blocked.message);
    return;
  }
  if (!isDatasetUri(uri)) {
    void vscode.window.showErrorMessage("Data Pilot supports local CSV and JSONL files only.");
    return;
  }

  await vscode.commands.executeCommand("vscode.openWith", uri, DATA_PILOT_VIEW_TYPE);
}
