/**
 * One engine child and one open dataset, shared by the NDJSON session and MCP.
 * Same path reuses the dataset id. A different path closes the previous one.
 */

import path from "node:path";
import type { IpcResponse } from "@data-pilot/contracts";
import { ChildProcessHost } from "./child-process-host.js";
import { resolveTsWorkerEntry } from "./paths.js";

export interface OpenBody {
  handle: {
    datasetId: string;
    format: string;
    columns: unknown;
    revision: unknown;
  };
  diagnostics: unknown;
}

export type EngineResult =
  | { ok: true; result: unknown }
  | { ok: false; message: string; fatal?: boolean };

function isChildDeath(message: string): boolean {
  return message.startsWith("Engine exited") || message.includes("Engine child is not running");
}

type IpcCall =
  | { kind: "response"; response: IpcResponse }
  | { kind: "dead"; message: string }
  | { kind: "error"; message: string };

export class DatasetSession {
  private open: { path: string; datasetId: string; body: OpenBody } | null = null;
  private shuttingDown = false;
  private inflight = false;
  private idleExit: (() => void) | null = null;
  private readonly host: ChildProcessHost;

  constructor() {
    this.host = new ChildProcessHost({
      workerEntry: resolveTsWorkerEntry(),
      trustMode: "trusted",
      onChildExit: () => {
        if (this.shuttingDown || this.inflight) return;
        this.idleExit?.();
      },
    });
  }

  onIdleChildExit(handler: () => void): void {
    this.idleExit = handler;
  }

  async start(): Promise<void> {
    await this.host.start();
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    const current = this.open;
    this.open = null;
    try {
      if (current) {
        await this.host
          .request("closeDataset", { datasetId: current.datasetId }, { timeoutMs: 5000 })
          .catch(() => undefined);
      }
    } finally {
      await this.host.stop();
    }
  }

  async describe(filePath: string): Promise<EngineResult> {
    const body = await this.ensureOpen(filePath);
    if (!("handle" in body)) return body;
    return { ok: true, result: { handle: body.handle, diagnostics: body.diagnostics } };
  }

  async preview(filePath: string): Promise<EngineResult> {
    const body = await this.ensureOpen(filePath);
    if (!("handle" in body)) return body;
    const preview = await this.ipc("preview", { datasetId: body.handle.datasetId });
    if (preview.kind !== "response") return this.callFailure(preview);
    if (!preview.response.ok) {
      return { ok: false, message: preview.response.error.message };
    }
    return {
      ok: true,
      result: {
        handle: {
          datasetId: body.handle.datasetId,
          format: body.handle.format,
          columns: body.handle.columns,
          revision: body.handle.revision,
        },
        preview: preview.response.result,
      },
    };
  }

  async query(
    filePath: string,
    dql: string,
    params?: Record<string, string>,
  ): Promise<EngineResult> {
    const body = await this.ensureOpen(filePath);
    if (!("handle" in body)) return body;
    const queried = await this.ipc("executeQuery", {
      datasetId: body.handle.datasetId,
      dql,
      ...(params && Object.keys(params).length > 0 ? { params } : {}),
    });
    if (queried.kind !== "response") return this.callFailure(queried);
    if (!queried.response.ok) {
      return { ok: false, message: queried.response.error.message };
    }
    return { ok: true, result: queried.response.result };
  }

  async exportQuery(
    filePath: string,
    dql: string,
    params?: Record<string, string>,
    format?: "csv" | "jsonl",
  ): Promise<EngineResult> {
    const body = await this.ensureOpen(filePath);
    if (!("handle" in body)) return body;
    const exported = await this.ipc("exportResult", {
      datasetId: body.handle.datasetId,
      dql,
      ...(params && Object.keys(params).length > 0 ? { params } : {}),
      ...(format !== undefined ? { format } : {}),
    });
    if (exported.kind !== "response") return this.callFailure(exported);
    if (!exported.response.ok) {
      return { ok: false, message: exported.response.error.message };
    }
    return { ok: true, result: exported.response.result };
  }

  async editCell(
    filePath: string,
    rowIndex: number,
    column: string,
    newRaw: string,
    apply: boolean,
  ): Promise<EngineResult> {
    const body = await this.ensureOpen(filePath);
    if (!("handle" in body)) return body;
    const edited = await this.ipc("editFixture", {
      datasetId: body.handle.datasetId,
      rowIndex,
      column,
      newRaw,
      apply,
    });
    if (edited.kind !== "response") return this.callFailure(edited);
    if (!edited.response.ok) {
      return { ok: false, message: edited.response.error.message };
    }
    return { ok: true, result: edited.response.result };
  }

  async close(): Promise<EngineResult> {
    if (!this.open) return { ok: true, result: { datasetId: null } };
    const datasetId = this.open.datasetId;
    const closed = await this.ipc("closeDataset", { datasetId });
    if (closed.kind !== "response") return this.callFailure(closed);
    if (!closed.response.ok) {
      return { ok: false, message: closed.response.error.message };
    }
    this.open = null;
    return { ok: true, result: { datasetId: null } };
  }

  private callFailure(call: { kind: "dead"; message: string } | { kind: "error"; message: string }): EngineResult {
    return { ok: false, message: call.message, ...(call.kind === "dead" ? { fatal: true } : {}) };
  }

  private async ensureOpen(filePath: string): Promise<OpenBody | EngineResult> {
    const resolved = resolveUserPath(filePath);
    if (this.open?.path === resolved) return this.open.body;
    if (this.open) {
      const closed = await this.ipc("closeDataset", { datasetId: this.open.datasetId });
      if (closed.kind !== "response") return this.callFailure(closed);
      if (!closed.response.ok) {
        return { ok: false, message: closed.response.error.message };
      }
      this.open = null;
    }
    const opened = await this.ipc("openDataset", { path: resolved });
    if (opened.kind !== "response") return this.callFailure(opened);
    if (!opened.response.ok) {
      return { ok: false, message: opened.response.error.message };
    }
    const body = opened.response.result as OpenBody;
    const datasetId = body.handle?.datasetId;
    if (!datasetId) {
      return { ok: false, message: "openDataset did not return a dataset id" };
    }
    this.open = { path: resolved, datasetId, body };
    return body;
  }

  private async ipc(
    op: "openDataset" | "preview" | "executeQuery" | "closeDataset" | "exportResult" | "editFixture",
    payload: unknown,
  ): Promise<IpcCall> {
    try {
      this.inflight = true;
      const response = await this.host.request(op, payload, { timeoutMs: 20000 });
      return { kind: "response", response };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return isChildDeath(message) ? { kind: "dead", message } : { kind: "error", message };
    } finally {
      this.inflight = false;
    }
  }
}

export function resolveUserPath(p: string): string {
  if (path.isAbsolute(p)) return p;
  const base = process.env.INIT_CWD ?? process.cwd();
  return path.resolve(base, p);
}
