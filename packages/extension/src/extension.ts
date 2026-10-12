import * as vscode from "vscode";
import type { SavedQuery } from "@data-pilot/contracts";
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
import { HostJobLog, hostJobOpen, type HostJob } from "./host-jobs";
import { HostJobTreeProvider } from "./host-job-view";
import { revealDatasetTab } from "./webview/dataset-panel";
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
  const jobs = new HostJobLog();

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
      new DatasetCustomEditorProvider(context, engine, savedQueryStore, jobs),
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  const datasetsTree = new DatasetTreeProvider(engine);
  const datasetsView = vscode.window.createTreeView("dataPilot.datasets", {
    treeDataProvider: datasetsTree,
  });
  datasetsTree.attach(datasetsView);
  const savedQueriesTree = new SavedQueryTreeProvider(savedQueryStore);
  const jobsTree = new HostJobTreeProvider(jobs);
  context.subscriptions.push(
    datasetsView,
    datasetsTree,
    vscode.window.registerTreeDataProvider("dataPilot.savedQueries", savedQueriesTree),
    savedQueriesTree,
    vscode.window.registerTreeDataProvider("dataPilot.jobs", jobsTree),
    jobsTree,
  );

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

  const renameSavedQueryCmd = vscode.commands.registerCommand(
    "dataPilot.renameSavedQuery",
    async (query?: SavedQuery) => {
      if (!query || typeof query.dql !== "string" || !savedQueryStore) return;
      const picked = await vscode.window.showInputBox({
        title: "Rename saved query",
        value: query.name ?? "",
        prompt: "Leave empty to show the query text.",
      });
      if (picked === undefined) return;
      savedQueryStore.rename(query, picked);
    },
  );

  const deleteSavedQueryCmd = vscode.commands.registerCommand(
    "dataPilot.deleteSavedQuery",
    (query?: SavedQuery) => {
      if (!query || typeof query.dql !== "string" || !savedQueryStore) return;
      savedQueryStore.remove(query);
    },
  );

  const deleteAllSavedQueriesCmd = vscode.commands.registerCommand(
    "dataPilot.deleteAllSavedQueries",
    async () => {
      if (!savedQueryStore) return;
      const choice = await vscode.window.showWarningMessage(
        "Delete all saved queries?",
        { modal: true },
        "Delete",
      );
      if (choice !== "Delete") return;
      savedQueryStore.clear();
    },
  );

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

  registerDqlEditor(context, engine, savedQueryStore, jobs);

  const openHostJobCmd = vscode.commands.registerCommand(
    "dataPilot.openHostJob",
    async (job?: HostJob) => {
      if (!job || typeof job.filePath !== "string" || !engine || !savedQueryStore) return;
      const target = hostJobOpen(job);
      if (target === "none") return;
      const opened = await openDatasetUri(engine, context, savedQueryStore, vscode.Uri.file(job.filePath));
      if (opened) revealDatasetTab(job.filePath, target);
    },
  );

  const cancelHostJobCmd = vscode.commands.registerCommand(
    "dataPilot.cancelHostJob",
    async (job?: HostJob) => {
      if (!job || !engine) return;
      if (!jobs.cancel(job.id)) return;
      await engine.cancelActiveQuery();
    },
  );

  context.subscriptions.push(
    openCmd,
    openResourceCmd,
    showLogCmd,
    openCustomEditorCmd,
    deleteSavedQueryCmd,
    deleteAllSavedQueriesCmd,
    renameSavedQueryCmd,
    openHostJobCmd,
    cancelHostJobCmd,
  );
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
