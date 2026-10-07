/**
 * Child-process engine entrypoint.
 * Speaks newline-delimited JSON IPC (see docs/adr/0002-ipc-protocol.md).
 * Launched by ChildProcessHost — not imported by the VS Code extension host path.
 */

import {
  PROTOCOL_VERSION,
  type Diagnostic,
  type EngineOp,
  type IpcRequest,
  type IpcResponse,
  isUntrustedAllowed,
} from "@data-pilot/contracts";
import { createInterface } from "node:readline";

const trustMode = process.env.DATA_PILOT_TRUST_MODE ?? "trusted";
const rssLimitMb = Number(process.env.DATA_PILOT_RSS_LIMIT_MB ?? "0");

let cancelled = new Set<string>();
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
    const target =
      typeof req.payload === "object" &&
      req.payload !== null &&
      "requestId" in req.payload
        ? String((req.payload as { requestId: string }).requestId)
        : req.requestId;
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
      heapUsedMb: Math.round((process.memoryUsage().heapUsed / (1024 * 1024)) * 100) / 100,
      uptimeMs: Math.round(process.uptime() * 1000),
    });
    return;
  }

  // Spike-only synthetic workloads — real dataset ops arrive in later phases.
  if (req.op === "preview") {
    const controller = new AbortController();
    inflight.set(req.requestId, controller);
    try {
      const payload = (req.payload ?? {}) as {
        allocateMb?: number;
        workMs?: number;
        crash?: boolean;
      };
      if (payload.crash) {
        process.exit(42);
      }
      const allocateMb = payload.allocateMb ?? 0;
      const workMs = payload.workMs ?? 5;
      const buffers: Buffer[] = [];
      if (allocateMb > 0) {
        buffers.push(Buffer.alloc(allocateMb * 1024 * 1024, 1));
      }
      const started = Date.now();
      while (Date.now() - started < workMs) {
        if (controller.signal.aborted || cancelled.has(req.requestId)) {
          ok(req.requestId, {
            completion: "cancelled",
            rssMb: rssMb(),
            note: "cooperative cancel",
          });
          return;
        }
        await new Promise((r) => setTimeout(r, 1));
      }
      void buffers;
      ok(req.requestId, {
        completion: "complete",
        rows: [],
        rssMb: rssMb(),
      });
    } finally {
      inflight.delete(req.requestId);
      cancelled.delete(req.requestId);
    }
    return;
  }

  fail(req.requestId, {
    code: "unsupported-operation",
    severity: "error",
    message: `Phase 0 stub does not implement '${req.op as EngineOp}' yet`,
  });
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

// Soft RSS watchdog for the spike — host may also kill us externally.
if (rssLimitMb > 0) {
  setInterval(() => {
    if (rssMb() > rssLimitMb) {
      process.stderr.write(
        JSON.stringify({
          event: "rss-limit-exceeded",
          rssMb: rssMb(),
          limitMb: rssLimitMb,
        }) + "\n",
      );
      process.exit(137);
    }
  }, 50).unref();
}

process.stderr.write(
  JSON.stringify({
    event: "ready",
    pid: process.pid,
    node: process.version,
    trustMode,
  }) + "\n",
);
