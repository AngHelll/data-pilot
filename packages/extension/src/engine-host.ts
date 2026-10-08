import * as vscode from "vscode";
import * as path from "node:path";
import {
  type Diagnostic,
  type DatasetHandle,
  type ExportArtifact,
  type ExportFormat,
  type IpcResponse,
  type QueryResult,
  type SavedQuery,
  type TrustMode,
} from "@data-pilot/contracts";
import { assertOpAllowed, type PlanResult, type SessionContext } from "@data-pilot/core";
import { ChildProcessHost } from "@data-pilot/runtime-node";
import { DatasetSessionRegistry, type OpenDatasetSession } from "./dataset-sessions";
import { replaceOpenDatasetFile } from "./fixture-writer";
import { logError, logInfo } from "./log";
import type { SerializedEditPreview } from "./webview/messages";
import * as fs from "node:fs";

export function workspaceTrustMode(): TrustMode {
  return vscode.workspace.isTrusted ? "trusted" : "untrusted-limited";
}

function trustContext(): SessionContext {
  return { trustMode: workspaceTrustMode() };
}

function ipcError(response: IpcResponse): Diagnostic {
  if (!response.ok) return response.error;
  return {
    code: "ipc-error",
    severity: "error",
    message: "Engine request failed",
  };
}

export class ExtensionEngineHost {
  private host: ChildProcessHost | undefined;
  private readonly sessions = new DatasetSessionRegistry();
  private readonly openHandles = new Map<
    string,
    { handle: DatasetHandle; diagnostics: Diagnostic[] }
  >();
  private activeQueryRequestId: string | undefined;
  private querySeq = 0;
  private trustListener: vscode.Disposable | undefined;
  /** Serializes open/close so concurrent custom-editor resolves cannot wedge IPC. */
  private openDatasetChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly extensionContext: vscode.ExtensionContext) {}

  /** Sessions already open in this window. The tree does not scan the workspace. */
  listOpenSessions(): OpenDatasetSession[] {
    return this.sessions.entries();
  }

  onSessionsChanged(listener: () => void): vscode.Disposable {
    return new vscode.Disposable(this.sessions.onChange(listener));
  }

  private workerEntry(): string {
    return this.extensionContext.asAbsolutePath(path.join("out", "engine-worker.js"));
  }

  private rssLimitMb(): number {
    return vscode.workspace.getConfiguration("dataPilot").get<number>("rssLimitMb", 256);
  }

  canEdit(): boolean {
    if (workspaceTrustMode() !== "trusted") return false;
    return vscode.workspace.getConfiguration("dataPilot").get<boolean>("allowEdit", true);
  }

  canExport(): boolean {
    if (workspaceTrustMode() !== "trusted") return false;
    return vscode.workspace.getConfiguration("dataPilot").get<boolean>("allowExport", true);
  }

  registerTrustListener(): void {
    this.trustListener?.dispose();
    this.trustListener = vscode.workspace.onDidGrantWorkspaceTrust(() => {
      void this.restartForTrustChange();
    });
    this.extensionContext.subscriptions.push(this.trustListener);
  }

  private async restartForTrustChange(): Promise<void> {
    const hadDataset = this.sessions.idsToClose().length > 0;
    await this.stop();
    if (hadDataset) {
      void vscode.window.showInformationMessage(
        "Workspace trust changed — Data Pilot engine restarted. Re-open your dataset if needed.",
      );
    }
  }

  async ensureStarted(): Promise<ChildProcessHost> {
    const trustMode = workspaceTrustMode();
    if (this.host) return this.host;

    const workerEntry = this.workerEntry();
    if (!fs.existsSync(workerEntry)) {
      const err = `Engine worker not found at ${workerEntry}. Re-run extension:compile or reinstall the VSIX.`;
      logError(err);
      throw { code: "worker-missing", severity: "error", message: err } satisfies Diagnostic;
    }

    this.host = new ChildProcessHost({
      workerEntry,
      trustMode,
      execPath: process.execPath,
      rssLimitMb: this.rssLimitMb(),
    });
    try {
      const { startupMs } = await this.host.start();
      logInfo(`Engine started in ${startupMs.toFixed(0)} ms (trust=${trustMode})`);
    } catch (err) {
      const detail = this.host.lastStderr.join("\n");
      logError(
        `Engine failed to start: ${err instanceof Error ? err.message : String(err)}`,
        detail || undefined,
      );
      this.host = undefined;
      throw err;
    }
    return this.host;
  }

  async stop(): Promise<void> {
    if (this.activeQueryRequestId && this.host) {
      await this.host.cancel(this.activeQueryRequestId).catch(() => undefined);
    }
    this.activeQueryRequestId = undefined;
    if (this.host) {
      for (const datasetId of this.sessions.idsToClose()) {
        await this.host
          .request("closeDataset", { datasetId }, { timeoutMs: 5000 })
          .catch(() => undefined);
      }
    }
    this.sessions.clear();
    this.openHandles.clear();
    await this.host?.stop();
    this.host = undefined;
  }

  async openDataset(filePath: string): Promise<{
    handle: DatasetHandle;
    diagnostics: Diagnostic[];
    preview: QueryResult;
  }> {
    const run = async (): Promise<{
      handle: DatasetHandle;
      diagnostics: Diagnostic[];
      preview: QueryResult;
    }> => {
      const blocked = assertOpAllowed(trustContext(), "openDataset");
      if (blocked) throw blocked;

      const host = await this.ensureStarted();

      const existingId = this.sessions.lookup(filePath);
      const cached = existingId ? this.openHandles.get(existingId) : undefined;
      if (existingId && cached) {
        logInfo(`IPC preview (reuse) → ${existingId}`);
        const preview = await host.request(
          "preview",
          { datasetId: existingId },
          { timeoutMs: 120_000 },
        );
        if (!preview.ok) throw ipcError(preview);
        return {
          handle: cached.handle,
          diagnostics: cached.diagnostics,
          preview: preview.result as QueryResult,
        };
      }

      logInfo(`IPC openDataset → ${filePath}`);
      const open = await host.request(
        "openDataset",
        { path: filePath },
        { timeoutMs: 120_000 },
      );
      if (!open.ok) throw ipcError(open);

      const opened = open.result as {
        handle: DatasetHandle;
        diagnostics: Diagnostic[];
      };
      this.sessions.remember(filePath, opened.handle.datasetId);
      this.openHandles.set(opened.handle.datasetId, {
        handle: opened.handle,
        diagnostics: opened.diagnostics,
      });

      logInfo(`IPC preview → ${opened.handle.datasetId}`);
      const preview = await host.request(
        "preview",
        { datasetId: opened.handle.datasetId },
        { timeoutMs: 120_000 },
      );
      if (!preview.ok) throw ipcError(preview);

      const previewResult = preview.result as QueryResult;
      logInfo(
        `IPC preview ok (${previewResult.rowCountReturned} rows, ${opened.handle.columns.length} cols)`,
      );

      return {
        handle: opened.handle,
        diagnostics: opened.diagnostics,
        preview: previewResult,
      };
    };

    const result = run();
    this.openDatasetChain = this.openDatasetChain.then(() => result, () => result);
    return result;
  }

  async refreshPreview(datasetId: string): Promise<QueryResult> {
    if (!datasetId) {
      throw {
        code: "no-dataset",
        severity: "error",
        message: "Open a dataset first",
      } satisfies Diagnostic;
    }
    const host = await this.ensureStarted();
    const preview = await host.request(
      "preview",
      { datasetId },
      { timeoutMs: 120_000 },
    );
    if (!preview.ok) throw ipcError(preview);
    return preview.result as QueryResult;
  }

  async inspectCell(datasetId: string, rowIndex: number, column: string): Promise<{
    display: string;
    raw: string;
    inferredType: string;
  }> {
    const blocked = assertOpAllowed(trustContext(), "inspectValue");
    if (blocked) throw blocked;
    if (!datasetId) {
      throw {
        code: "no-dataset",
        severity: "error",
        message: "Open a dataset first",
      } satisfies Diagnostic;
    }
    const host = await this.ensureStarted();
    const response = await host.request(
      "inspectValue",
      { datasetId, rowIndex, column },
      { timeoutMs: 60_000 },
    );
    if (!response.ok) throw ipcError(response);
    const body = response.result as {
      value: { kind: string };
      raw: string;
      inferredType: string;
    };
    const display =
      body.value.kind === "null"
        ? "null"
        : body.value.kind === "missing"
          ? "·"
          : body.raw;
    return { display, raw: body.raw, inferredType: body.inferredType };
  }

  async planQuery(datasetId: string, dql: string): Promise<PlanResult> {
    const blocked = assertOpAllowed(trustContext(), "planQuery");
    if (blocked) return { diagnostics: [blocked] };
    if (!datasetId) {
      return {
        diagnostics: [
          {
            code: "no-dataset",
            severity: "error",
            message: "Open a dataset first",
          },
        ],
      };
    }
    const host = await this.ensureStarted();
    const response = await host.request(
      "planQuery",
      { datasetId, dql },
      { timeoutMs: 15_000 },
    );
    if (!response.ok) {
      return { diagnostics: [ipcError(response)] };
    }
    return response.result as PlanResult;
  }

  async executeQuery(datasetId: string, dql: string): Promise<QueryResult> {
    const blocked = assertOpAllowed(trustContext(), "executeQuery");
    if (blocked) throw blocked;
    if (!datasetId) {
      throw {
        code: "no-dataset",
        severity: "error",
        message: "Open a dataset first",
      } satisfies Diagnostic;
    }

    const host = await this.ensureStarted();
    const requestId = `ext-query-${++this.querySeq}-${Date.now()}`;
    this.activeQueryRequestId = requestId;
    try {
      const response = await host.requestWithId(
        requestId,
        "executeQuery",
        { datasetId, dql, budget: { maxRows: 500 } },
        { timeoutMs: 120_000 },
      );
      if (!response.ok) throw ipcError(response);
      return response.result as QueryResult;
    } finally {
      this.activeQueryRequestId = undefined;
    }
  }

  async cancelActiveQuery(): Promise<void> {
    if (!this.activeQueryRequestId || !this.host) return;
    await this.host.cancel(this.activeQueryRequestId).catch(() => undefined);
  }

  async proposeEdit(
    datasetId: string,
    rowIndex: number,
    column: string,
    newRaw: string,
  ): Promise<SerializedEditPreview> {
    if (!this.canEdit()) {
      throw {
        code: "edit-disabled",
        severity: "error",
        message: "Fixture edit is disabled (trust workspace and dataPilot.allowEdit)",
      } satisfies Diagnostic;
    }
    const blocked = assertOpAllowed(trustContext(), "editFixture");
    if (blocked) throw blocked;
    if (!datasetId) {
      throw {
        code: "no-dataset",
        severity: "error",
        message: "Open a dataset first",
      } satisfies Diagnostic;
    }
    const host = await this.ensureStarted();
    const response = await host.request(
      "editFixture",
      {
        datasetId,
        rowIndex,
        column,
        newRaw,
        apply: false,
      },
      { timeoutMs: 60_000 },
    );
    if (!response.ok) throw ipcError(response);
    return response.result as SerializedEditPreview;
  }

  async applyEdit(
    datasetId: string,
    rowIndex: number,
    column: string,
    newRaw: string,
  ): Promise<{
    written: boolean;
    path: string;
    editPreview: SerializedEditPreview;
  }> {
    if (!this.canEdit()) {
      throw {
        code: "edit-disabled",
        severity: "error",
        message: "Fixture edit is disabled",
      } satisfies Diagnostic;
    }
    const blocked = assertOpAllowed(trustContext(), "editFixture");
    if (blocked) throw blocked;
    if (!datasetId) {
      throw {
        code: "no-dataset",
        severity: "error",
        message: "Open a dataset first",
      } satisfies Diagnostic;
    }
    const host = await this.ensureStarted();
    const response = await host.request(
      "editFixture",
      { datasetId, rowIndex, column, newRaw, apply: true },
      { timeoutMs: 60_000 },
    );
    if (!response.ok) throw ipcError(response);
    const result = response.result as SerializedEditPreview & { afterText?: string };
    const editPreview: SerializedEditPreview = {
      path: result.path,
      rowIndex: result.rowIndex,
      column: result.column,
      oldRaw: result.oldRaw,
      newRaw: result.newRaw,
      unifiedDiff: result.unifiedDiff,
    };
    if (result.oldRaw === result.newRaw) {
      return { written: false, path: result.path, editPreview };
    }
    if (typeof result.afterText !== "string" || !result.path) {
      throw {
        code: "edit-empty",
        severity: "error",
        message: "Engine did not return file text for apply",
      } satisfies Diagnostic;
    }
    await replaceOpenDatasetFile(result.path, result.afterText);
    return { written: true, path: result.path, editPreview };
  }

  async saveQuery(datasetId: string, dql: string): Promise<SavedQuery> {
    const blocked = assertOpAllowed(trustContext(), "saveQuery");
    if (blocked) throw blocked;
    if (!datasetId) {
      throw {
        code: "no-dataset",
        severity: "error",
        message: "Open a dataset first",
      } satisfies Diagnostic;
    }
    const host = await this.ensureStarted();
    const response = await host.request(
      "saveQuery",
      { datasetId, dql },
      { timeoutMs: 15_000 },
    );
    if (!response.ok) throw ipcError(response);
    return response.result as SavedQuery;
  }

  async exportQueryResult(
    datasetId: string,
    dql: string,
    format: ExportFormat = "same-as-source",
  ): Promise<ExportArtifact> {
    if (!this.canExport()) {
      throw {
        code: "export-disabled",
        severity: "error",
        message: "Export is disabled (trust workspace and dataPilot.allowExport)",
      } satisfies Diagnostic;
    }
    if (!datasetId) {
      throw {
        code: "no-dataset",
        severity: "error",
        message: "Open a dataset first",
      } satisfies Diagnostic;
    }
    const host = await this.ensureStarted();
    const response = await host.request(
      "exportResult",
      { datasetId, dql, format },
      { timeoutMs: 120_000 },
    );
    if (!response.ok) throw ipcError(response);
    return response.result as ExportArtifact;
  }
}
