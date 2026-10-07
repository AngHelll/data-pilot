/**
 * Child-process engine entrypoint.
 * Speaks newline-delimited JSON IPC (see docs/adr/0002-ipc-protocol.md).
 */

import {
  PROTOCOL_VERSION,
  type Diagnostic,
  type EngineOp,
  type ExecuteQueryPayload,
  type EditFixturePayload,
  type ExportResultPayload,
  type InspectValuePayload,
  type SaveQueryPayload,
  type IpcRequest,
  type IpcResponse,
  type OpenDatasetPayload,
  type PreviewPayload,
  type TrustMode,
  isUntrustedAllowed,
} from "@data-pilot/contracts";
import {
  DatasetService,
  EditService,
  ExportService,
  QueryService,
  isDiagnostic,
} from "@data-pilot/core";
import { DatasetStore } from "@data-pilot/engine-stream";
import { createInterface } from "node:readline";

const trustMode = (process.env.DATA_PILOT_TRUST_MODE ?? "trusted") as TrustMode;
const rssLimitMb = Number(process.env.DATA_PILOT_RSS_LIMIT_MB ?? "0");

const store = new DatasetStore();
const datasets = new DatasetService(store, trustMode);
const queries = new QueryService(store, trustMode);
const edits = new EditService(store, { trustMode });
const exportsSvc = new ExportService(store, queries, { trustMode });

const cancelled = new Set<string>();
const inflight = new Map<string, AbortController>();

function respond(response: IpcResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function fail(requestId: string, error: Diagnostic): void {
  respond({
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    ok: false,
    error,
  });
}

function ok(requestId: string, result: unknown): void {
  respond({
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    ok: true,
    result,
  });
}

function rssMb(): number {
  return Math.round((process.memoryUsage().rss / (1024 * 1024)) * 100) / 100;
}

function asRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>)
    : {};
}

async function handleSpikePreview(
  requestId: string,
  payload: PreviewPayload,
  controller: AbortController,
): Promise<void> {
  if (payload.crash) process.exit(42);
  const allocateMb = payload.allocateMb ?? 0;
  const workMs = payload.workMs ?? 5;
  const buffers: Buffer[] = [];
  if (allocateMb > 0) buffers.push(Buffer.alloc(allocateMb * 1024 * 1024, 1));
  const started = Date.now();
  while (Date.now() - started < workMs) {
    if (controller.signal.aborted || cancelled.has(requestId)) {
      ok(requestId, {
        completion: "cancelled",
        rssMb: rssMb(),
        note: "cooperative cancel",
      });
      return;
    }
    await new Promise((r) => setTimeout(r, 1));
  }
  void buffers;
  ok(requestId, { completion: "complete", rows: [], rssMb: rssMb() });
}

async function handle(req: IpcRequest): Promise<void> {
  if (req.protocolVersion !== PROTOCOL_VERSION) {
    fail(req.requestId, {
      code: "protocol-version-mismatch",
      severity: "error",
      message: `Expected protocolVersion ${PROTOCOL_VERSION}, got ${String(req.protocolVersion)}`,
    });
    return;
  }

  if (trustMode === "untrusted-limited" && !isUntrustedAllowed(req.op)) {
    fail(req.requestId, {
      code: "untrusted-blocked",
      severity: "error",
      message: `Operation '${req.op}' is blocked in untrusted workspaces`,
    });
    return;
  }

  if (req.op === "cancelJob") {
    const body = asRecord(req.payload);
    const target =
      typeof body.requestId === "string" ? body.requestId : req.requestId;
    cancelled.add(target);
    inflight.get(target)?.abort();
    ok(req.requestId, { cancelled: target });
    return;
  }

  if (req.op === "ping") {
    ok(req.requestId, {
      pong: true,
      pid: process.pid,
      rssMb: rssMb(),
      node: process.version,
    });
    return;
  }

  if (req.op === "getStats") {
    ok(req.requestId, {
      pid: process.pid,
      rssMb: rssMb(),
      heapUsedMb:
        Math.round((process.memoryUsage().heapUsed / (1024 * 1024)) * 100) / 100,
      uptimeMs: Math.round(process.uptime() * 1000),
    });
    return;
  }

  const controller = new AbortController();
  inflight.set(req.requestId, controller);
  try {
    switch (req.op) {
      case "openDataset": {
        const p = asRecord(req.payload) as unknown as OpenDatasetPayload;
        if (!p.path) {
          fail(req.requestId, {
            code: "invalid-payload",
            severity: "error",
            message: "openDataset requires path",
          });
          return;
        }
        const result = await datasets.open(p.path, {
          ...(p.format !== undefined ? { format: p.format } : {}),
        });
        ok(req.requestId, result);
        return;
      }
      case "describeDataset": {
        const datasetId = String(asRecord(req.payload).datasetId ?? "");
        ok(req.requestId, datasets.describe(datasetId));
        return;
      }
      case "preview": {
        const p = asRecord(req.payload) as unknown as PreviewPayload;
        if (!p.datasetId && (p.allocateMb || p.workMs || p.crash)) {
          await handleSpikePreview(req.requestId, p, controller);
          return;
        }
        if (!p.datasetId) {
          fail(req.requestId, {
            code: "invalid-payload",
            severity: "error",
            message: "preview requires datasetId",
          });
          return;
        }
        const result = await datasets.preview(
          p.datasetId,
          p.budget,
          req.requestId,
          controller.signal,
        );
        ok(req.requestId, result);
        return;
      }
      case "planQuery": {
        const p = asRecord(req.payload) as unknown as ExecuteQueryPayload;
        ok(
          req.requestId,
          queries.plan(p.datasetId, p.dql, p.params),
        );
        return;
      }
      case "executeQuery": {
        const p = asRecord(req.payload) as unknown as ExecuteQueryPayload;
        const result = await queries.execute(
          p.datasetId,
          p.dql,
          p.params,
          p.budget ?? {},
          req.requestId,
          controller.signal,
        );
        ok(req.requestId, result);
        return;
      }
      case "inspectValue": {
        const p = asRecord(req.payload) as unknown as InspectValuePayload;
        const result = await datasets.inspect(p.datasetId, p.rowIndex, p.column);
        if (isDiagnostic(result)) fail(req.requestId, result);
        else ok(req.requestId, result);
        return;
      }
      case "closeDataset": {
        const datasetId = String(asRecord(req.payload).datasetId ?? "");
        datasets.close(datasetId);
        ok(req.requestId, { closed: datasetId });
        return;
      }
      case "editFixture": {
        const p = asRecord(req.payload) as unknown as EditFixturePayload;
        if (!p.datasetId || typeof p.rowIndex !== "number" || !p.column) {
          fail(req.requestId, {
            code: "invalid-payload",
            severity: "error",
            message: "editFixture requires datasetId, rowIndex, and column",
          });
          return;
        }
        const newRaw = typeof p.newRaw === "string" ? p.newRaw : "";
        if (p.apply) {
          const result = await edits.apply(p.datasetId, p.rowIndex, p.column, newRaw);
          ok(req.requestId, result);
          return;
        }
        const preview = await edits.preview(p.datasetId, p.rowIndex, p.column, newRaw);
        ok(req.requestId, preview);
        return;
      }
      case "saveQuery": {
        const p = asRecord(req.payload) as unknown as SaveQueryPayload;
        if (!p.datasetId || typeof p.dql !== "string") {
          fail(req.requestId, {
            code: "invalid-payload",
            severity: "error",
            message: "saveQuery requires datasetId and dql",
          });
          return;
        }
        const saved = queries.saveQuery(p.datasetId, p.dql, p.params);
        if (isDiagnostic(saved)) {
          fail(req.requestId, saved);
          return;
        }
        ok(req.requestId, saved);
        return;
      }
      case "exportResult": {
        const p = asRecord(req.payload) as unknown as ExportResultPayload;
        if (!p.datasetId || typeof p.dql !== "string") {
          fail(req.requestId, {
            code: "invalid-payload",
            severity: "error",
            message: "exportResult requires datasetId and dql",
          });
          return;
        }
        const artifact = await exportsSvc.exportQueryResult(
          p.datasetId,
          p.dql,
          p.params,
          {
            ...(p.format !== undefined ? { format: p.format } : {}),
            ...(p.budget !== undefined ? { budget: p.budget } : {}),
          },
        );
        if (isDiagnostic(artifact)) {
          fail(req.requestId, artifact);
          return;
        }
        ok(req.requestId, artifact);
        return;
      }
      case "globalScan":
      case "agentQuery":
        fail(req.requestId, {
          code: "unsupported-operation",
          severity: "error",
          message: `Operation '${req.op}' is not implemented in Phase 1–2`,
        });
        return;
      default:
        fail(req.requestId, {
          code: "unsupported-operation",
          severity: "error",
          message: `Unknown op '${req.op as EngineOp}'`,
        });
    }
  } catch (err) {
    if (isDiagnostic(err)) {
      fail(req.requestId, err);
      return;
    }
    fail(req.requestId, {
      code: "runtime-error",
      severity: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    inflight.delete(req.requestId);
    cancelled.delete(req.requestId);
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", (line) => {
  if (!line.trim()) return;
  let req: IpcRequest;
  try {
    req = JSON.parse(line) as IpcRequest;
  } catch {
    fail("unknown", {
      code: "invalid-json",
      severity: "error",
      message: "IPC line was not valid JSON",
    });
    return;
  }
  void handle(req);
});

if (rssLimitMb > 0) {
  setInterval(() => {
    if (rssMb() > rssLimitMb) {
      process.stderr.write(
        `${JSON.stringify({
          event: "rss-limit-exceeded",
          rssMb: rssMb(),
          limitMb: rssLimitMb,
        })}\n`,
      );
      process.exit(137);
    }
  }, 50).unref();
}

process.stderr.write(
  `${JSON.stringify({
    event: "ready",
    pid: process.pid,
    node: process.version,
    trustMode,
  })}\n`,
);
