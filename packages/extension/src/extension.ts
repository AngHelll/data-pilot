import * as vscode from "vscode";
import { assertOpAllowed } from "@data-pilot/core";
import {
  DATA_PILOT_VIEW_TYPE,
  DatasetCustomEditorProvider,
} from "./dataset-custom-editor";
import { ExtensionEngineHost, workspaceTrustMode } from "./engine-host";
import { openDatasetUri } from "./open-dataset";
import { DatasetTreeProvider } from "./dataset-tree";
import { SavedQueryTreeProvider } from "./saved-query-view";
import { registerDqlEditor } from "./dql-editor";
import { dataPilotLog, logError, logInfo } from "./log";
import { SavedQueryStore } from "./saved-query-store";
import { datasetTabPaths, isDatasetUri } from "./dataset-uri";
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

  const datasetsTree = new DatasetTreeProvider(engine);
  const savedQueriesTree = new SavedQueryTreeProvider(savedQueryStore);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("dataPilot.datasets", datasetsTree),
    datasetsTree,
    vscode.window.registerTreeDataProvider("dataPilot.savedQueries", savedQueriesTree),
    savedQueriesTree,
  );

  const rememberOpenDatasetTabs = async (): Promise<void> => {
    if (!engine) return;
    const open = new Set(engine.listOpenSessions().map((session) => session.filePath));
    const paths: string[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (input instanceof vscode.TabInputText) paths.push(input.uri.fsPath);
      }
    }
    for (const filePath of datasetTabPaths(paths)) {
      if (open.has(filePath)) continue;
      try {
        await engine.openDataset(filePath);
        open.add(filePath);
      } catch (err) {
        logError(
          `Could not list open dataset ${filePath}`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  };

  let tabTimer: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs(() => {
      if (tabTimer) clearTimeout(tabTimer);
      tabTimer = setTimeout(() => {
        void rememberOpenDatasetTabs();
      }, 300);
    }),
  );
  void rememberOpenDatasetTabs();

  const openFromUri = async (uri: vscode.Uri): Promise<void> => {
    if (!engine || !savedQueryStore) return;
    await openDatasetUri(engine, context, savedQueryStore, uri);
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
      await openDatasetUri(engine, context, savedQueryStore, target);
    },
  );

  registerDqlEditor(context, engine);

  context.subscriptions.push(openCmd, openResourceCmd, showLogCmd, openCustomEditorCmd);
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
