import * as vscode from "vscode";
import { assertOpAllowed } from "@data-pilot/core";
import {
  DATA_PILOT_VIEW_TYPE,
  DatasetCustomEditorProvider,
} from "./dataset-custom-editor";
import { ExtensionEngineHost, workspaceTrustMode } from "./engine-host";
import { openDatasetUri } from "./open-dataset";
import {
  DATA_PILOT_EXPLORER_VIEW_ID,
  DatasetExplorerWebviewProvider,
} from "./dataset-explorer-view";
import { dataPilotLog, logInfo } from "./log";
import { SavedQueryStore } from "./saved-query-store";
import { isDatasetUri } from "./dataset-uri";
import * as fs from "node:fs";
import * as path from "node:path";

let engine: ExtensionEngineHost | undefined;
let savedQueryStore: SavedQueryStore | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  engine = new ExtensionEngineHost(context);
  engine.registerTrustListener();
  savedQueryStore = new SavedQueryStore(context);

  if (!engine || !savedQueryStore) return;

  const workerPath = context.asAbsolutePath(path.join("out", "engine-worker.js"));
  if (fs.existsSync(workerPath)) {
    logInfo(`Extension active. Engine worker: ${workerPath}`);
  } else {
    logInfo(`Extension active but engine worker missing: ${workerPath}`);
  }

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      DATA_PILOT_VIEW_TYPE,
      new DatasetCustomEditorProvider(context, engine, savedQueryStore),
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  const explorerView = new DatasetExplorerWebviewProvider(context, engine, savedQueryStore);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(DATA_PILOT_EXPLORER_VIEW_ID, explorerView, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  let syncEditorTimer: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!explorerView.hasSession()) return;
      if (syncEditorTimer) clearTimeout(syncEditorTimer);
      syncEditorTimer = setTimeout(() => {
        explorerView.syncFromActiveEditor(editor);
      }, 300);
    }),
  );

  const openFromUri = async (uri: vscode.Uri): Promise<void> => {
    if (!engine || !savedQueryStore) return;
    await openDatasetUri(engine, context, savedQueryStore, uri, explorerView);
  };

  const openCmd = vscode.commands.registerCommand("dataPilot.openDataset", async () => {
    const blocked = assertOpAllowed(
      { trustMode: workspaceTrustMode() },
      "openDataset",
    );
    if (blocked) {
      void vscode.window.showErrorMessage(blocked.message);
      return;
    }

    const uri = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { Datasets: ["csv", "jsonl", "ndjson"] },
      title: "Open dataset (CSV or JSONL)",
    });
    if (!uri?.[0]) return;
    await openFromUri(uri[0]);
  });

  const openResourceCmd = vscode.commands.registerCommand(
    "dataPilot.openDatasetResource",
    async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        void vscode.window.showInformationMessage(
          "Select a CSV or JSONL file, or use “Data Pilot: Open Dataset”.",
        );
        return;
      }
      await openFromUri(target);
    },
  );

  const showLogCmd = vscode.commands.registerCommand("dataPilot.showLog", () => {
    dataPilotLog().show(true);
  });

  const openCustomEditorCmd = vscode.commands.registerCommand(
    "dataPilot.openDatasetCustomEditor",
    async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target || !isDatasetUri(target)) {
        void vscode.window.showInformationMessage("Open a CSV or JSONL file first.");
        return;
      }
      if (!engine || !savedQueryStore) return;
      await openDatasetUri(engine, context, savedQueryStore, target, explorerView, "custom-editor");
    },
  );

  const refreshPreviewCmd = vscode.commands.registerCommand(
    "dataPilot.refreshExplorerPreview",
    async () => {
      const uri = vscode.window.activeTextEditor?.document.uri;
      if (!uri || !isDatasetUri(uri)) {
        void vscode.window.showInformationMessage("Focus a CSV or JSONL editor tab to refresh.");
        return;
      }
      await explorerView.loadDataset(uri.fsPath, { force: true });
    },
  );

  context.subscriptions.push(openCmd, openResourceCmd, showLogCmd, openCustomEditorCmd, refreshPreviewCmd);
  context.subscriptions.push({
    dispose: () => {
      void engine?.stop();
      engine = undefined;
      savedQueryStore = undefined;
    },
  });
}

export async function deactivate(): Promise<void> {
  await engine?.stop();
  engine = undefined;
  savedQueryStore = undefined;
}
