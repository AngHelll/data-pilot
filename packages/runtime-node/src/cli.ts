#!/usr/bin/env node
/**
 * Headless bin: one-shot preview, describe, and query, an NDJSON session, or MCP.
 * Spawns one engine child. Does not edit, export, or call agentQuery.
 *
 *   npm run data-pilot -- preview fixtures/sample/tiny.csv
 *   npm run data-pilot -- query fixtures/sample/tiny.csv 'where country = "MX"'
 *   npm run data-pilot
 *   npm run data-pilot -- mcp
 */

import path from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import type { Diagnostic, IpcResponse } from "@data-pilot/contracts";
import { DatasetSession, resolveUserPath, type EngineResult, type OpenBody } from "./cli-engine.js";
import { ChildProcessHost } from "./child-process-host.js";
import { resolveTsWorkerEntry } from "./paths.js";

interface QueryBody {
  completion?: string;
  diagnostics?: Diagnostic[];
}

function usage(): void {
  console.error(`Usage:
  data-pilot preview <file.csv|file.jsonl>
  data-pilot query <file> <dql> [--param name=value]...
  data-pilot describe <file>
  data-pilot
      Read NDJSON actions (preview, describe, query, close) on stdin.
  data-pilot mcp
      Serve preview, describe, and query over MCP stdio.`);
}

/** Prefer npm's INIT_CWD so `npm run preview -- fixtures/...` works from repo root. */
function parseParamArgs(args: string[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--param" && args[i + 1]) {
      const raw = args[++i]!;
      const eq = raw.indexOf("=");
      if (eq <= 0) continue;
      params[raw.slice(0, eq)] = raw.slice(eq + 1);
    }
  }
  return params;
}

function writeQueryFailure(diagnostics: Diagnostic[] | undefined): void {
  const messages = (diagnostics ?? [])
    .filter((d) => d.severity === "error" && d.message)
    .map((d) => d.message);
  if (messages.length === 0) {
    console.error("Query failed");
    return;
  }
  for (const message of messages) console.error(message);
  if (messages.some((message) => message.startsWith("Unknown stage"))) {
    console.error("DQL 0.1 filters start with where.");
  }
}

async function runCommand(argv: string[]): Promise<number> {
  const cmd = argv[0];
  if (cmd === "-h" || cmd === "--help") {
    usage();
    return 2;
  }
  if (!cmd) return runSession();
  if (cmd === "mcp") return runMcp();
  if (cmd !== "preview" && cmd !== "describe" && cmd !== "query") {
    usage();
    return 2;
  }

  const file = argv[1];
  const dql = argv[2];
  if (!file || (cmd === "query" && !dql)) {
    usage();
    return 2;
  }

  const host = new ChildProcessHost({
    workerEntry: resolveTsWorkerEntry(),
    trustMode: "trusted",
  });
  let code = 1;
  try {
    await host.start();
    const opened = await host.request(
      "openDataset",
      { path: resolveUserPath(file) },
      { timeoutMs: 20000 },
    );
    if (!opened.ok) {
      console.error(opened.error.message);
      return 1;
    }
    const body = opened.result as OpenBody;
    const datasetId = body.handle?.datasetId;
    if (!datasetId) {
      console.error("openDataset did not return a dataset id");
      return 1;
    }
    try {
      code = await dispatch(host, cmd, datasetId, body, dql, argv.slice(3));
    } finally {
      await host
        .request("closeDataset", { datasetId }, { timeoutMs: 5000 })
        .catch((err: unknown) => {
          console.error(err instanceof Error ? err.message : err);
        });
    }
    return code;
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return 1;
  } finally {
    await host.stop();
  }
}

async function dispatch(
  host: ChildProcessHost,
  cmd: "preview" | "describe" | "query",
  datasetId: string,
  opened: OpenBody,
  dql: string | undefined,
  rest: string[],
): Promise<number> {
  if (cmd === "describe") {
    console.log(JSON.stringify({ handle: opened.handle, diagnostics: opened.diagnostics }, null, 2));
    return 0;
  }

  if (cmd === "preview") {
    const preview = await host.request("preview", { datasetId }, { timeoutMs: 20000 });
    if (!preview.ok) {
      console.error(preview.error.message);
      return 1;
    }
    console.log(
      JSON.stringify(
        {
          handle: {
            datasetId: opened.handle.datasetId,
            format: opened.handle.format,
            columns: opened.handle.columns,
            revision: opened.handle.revision,
          },
          preview: preview.result,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  const params = parseParamArgs(rest);
  const queried = await host.request(
    "executeQuery",
    {
      datasetId,
      dql,
      ...(Object.keys(params).length > 0 ? { params } : {}),
    },
    { timeoutMs: 20000 },
  );
  return finishQuery(queried);
}

const BLOCKED_SESSION_OPS = new Set(["edit", "export", "compare", "agentQuery"]);

interface SessionReply {
  id: string | null;
  ok: boolean;
  result?: unknown;
  error?: { message: string };
}

function writeReply(reply: SessionReply): void {
  process.stdout.write(`${JSON.stringify(reply)}\n`);
}

function readParams(value: unknown): Record<string, string> | undefined | "bad" {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "bad";
  const params: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") return "bad";
    params[key] = item;
  }
  return params;
}

async function runSession(): Promise<number> {
  const engine = new DatasetSession();
  let stopping = false;

  async function finish(code: number): Promise<void> {
    if (stopping) return;
    stopping = true;
    await engine.shutdown();
    process.exit(code);
  }

  engine.onIdleChildExit(() => {
    writeReply({ id: null, ok: false, error: { message: "Engine child exited" } });
    void finish(1);
  });

  try {
    await engine.start();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return 1;
  }

  async function replyResult(id: string, outcome: EngineResult): Promise<void> {
    if (!outcome.ok) {
      writeReply({ id, ok: false, error: { message: outcome.message } });
      if (outcome.fatal) await finish(1);
      return;
    }
    writeReply({ id, ok: true, result: outcome.result });
  }

  async function handleLine(line: string): Promise<void> {
    if (!line.trim() || stopping) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      writeReply({ id: null, ok: false, error: { message: "Invalid JSON" } });
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      writeReply({ id: null, ok: false, error: { message: "Expected a JSON object" } });
      return;
    }
    const rec = parsed as Record<string, unknown>;
    if (typeof rec.id !== "string") {
      writeReply({ id: null, ok: false, error: { message: "id must be a string" } });
      return;
    }
    const id = rec.id;
    const op = rec.op;
    if (typeof op !== "string" || BLOCKED_SESSION_OPS.has(op)) {
      const name = typeof op === "string" ? op : String(op);
      writeReply({
        id,
        ok: false,
        error: { message: `Operation '${name}' is not available` },
      });
      return;
    }
    if (op !== "preview" && op !== "describe" && op !== "query" && op !== "close") {
      writeReply({ id, ok: false, error: { message: `Unknown op '${op}'` } });
      return;
    }

    if (op === "close") {
      await replyResult(id, await engine.close());
      return;
    }

    if (typeof rec.path !== "string" || rec.path.length === 0) {
      writeReply({ id, ok: false, error: { message: `${op} requires path` } });
      return;
    }

    if (op === "describe") {
      await replyResult(id, await engine.describe(rec.path));
      return;
    }
    if (op === "preview") {
      await replyResult(id, await engine.preview(rec.path));
      return;
    }

    if (typeof rec.dql !== "string") {
      writeReply({ id, ok: false, error: { message: "query requires dql" } });
      return;
    }
    const params = readParams(rec.params);
    if (params === "bad") {
      writeReply({ id, ok: false, error: { message: "params must be an object of strings" } });
      return;
    }
    await replyResult(id, await engine.query(rec.path, rec.dql, params));
  }

  return readLines(handleLine, () => finish(0));
}

const MCP_TOOLS = [
  {
    name: "preview",
    description: "Bounded preview of a CSV or JSONL file.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "describe",
    description: "Format, columns, and open diagnostics for a CSV or JSONL file.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "query",
    description: "Run one DQL 0.1 query. Filters start with where.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        dql: { type: "string" },
        params: { type: "object", additionalProperties: { type: "string" } },
      },
      required: ["path", "dql"],
    },
  },
] as const;

function writeRpc(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function toolResult(id: string | number | null, text: string, isError: boolean): void {
  writeRpc({
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text }], isError },
  });
}

function completionError(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { completion?: string }).completion === "error"
  );
}

async function runMcp(): Promise<number> {
  const engine = new DatasetSession();
  let stopping = false;

  async function finish(code: number): Promise<void> {
    if (stopping) return;
    stopping = true;
    await engine.shutdown();
    process.exit(code);
  }

  engine.onIdleChildExit(() => {
    void finish(1);
  });

  try {
    await engine.start();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return 1;
  }

  async function callTool(id: string | number | null, name: string, args: Record<string, unknown>): Promise<void> {
    if (name === "edit" || name === "export" || name === "compare" || name === "agentQuery") {
      toolResult(id, `Tool '${name}' is not available`, true);
      return;
    }
    if (name !== "preview" && name !== "describe" && name !== "query") {
      toolResult(id, `Unknown tool '${name}'`, true);
      return;
    }
    if (typeof args.path !== "string" || args.path.length === 0) {
      toolResult(id, `${name} requires path`, true);
      return;
    }
    let outcome: EngineResult;
    if (name === "describe") outcome = await engine.describe(args.path);
    else if (name === "preview") outcome = await engine.preview(args.path);
    else {
      if (typeof args.dql !== "string") {
        toolResult(id, "query requires dql", true);
        return;
      }
      const params = readParams(args.params);
      if (params === "bad") {
        toolResult(id, "params must be an object of strings", true);
        return;
      }
      outcome = await engine.query(args.path, args.dql, params);
    }
    if (!outcome.ok) {
      toolResult(id, outcome.message, true);
      if (outcome.fatal) await finish(1);
      return;
    }
    toolResult(id, JSON.stringify(outcome.result), completionError(outcome.result));
  }

  async function handleLine(line: string): Promise<void> {
    if (!line.trim() || stopping) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      writeRpc({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON" } });
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      writeRpc({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Expected a JSON object" } });
      return;
    }
    const rec = parsed as Record<string, unknown>;
    const method = rec.method;
    const hasId = "id" in rec && rec.id !== undefined;
    const id = typeof rec.id === "string" || typeof rec.id === "number" ? rec.id : null;
    if (typeof method !== "string") {
      if (hasId) writeRpc({ jsonrpc: "2.0", id, error: { code: -32600, message: "Missing method" } });
      return;
    }
    if (!hasId || method.startsWith("notifications/")) return;

    if (method === "initialize") {
      const params = rec.params;
      const requested =
        typeof params === "object" && params !== null && typeof (params as { protocolVersion?: unknown }).protocolVersion === "string"
          ? (params as { protocolVersion: string }).protocolVersion
          : "2024-11-05";
      writeRpc({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: requested,
          capabilities: { tools: {} },
          serverInfo: { name: "data-pilot", version: "0.0.0" },
        },
      });
      return;
    }
    if (method === "tools/list") {
      writeRpc({ jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } });
      return;
    }
    if (method === "tools/call") {
      const params = rec.params;
      if (typeof params !== "object" || params === null) {
        toolResult(id, "tools/call requires params", true);
        return;
      }
      const name = (params as { name?: unknown }).name;
      const args = (params as { arguments?: unknown }).arguments;
      if (typeof name !== "string") {
        toolResult(id, "tools/call requires a tool name", true);
        return;
      }
      const record =
        typeof args === "object" && args !== null && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {};
      await callTool(id, name, record);
      return;
    }
    writeRpc({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  }

  return readLines(handleLine, () => finish(0));
}

function readLines(
  handleLine: (line: string) => Promise<void>,
  onEnd: () => Promise<void>,
): Promise<number> {
  const queue: string[] = [];
  let working = false;
  let stdinEnded = false;

  async function pump(): Promise<void> {
    if (working) return;
    working = true;
    try {
      while (queue.length > 0) {
        const line = queue.shift() ?? "";
        await handleLine(line);
      }
    } finally {
      working = false;
    }
    if (stdinEnded && queue.length === 0) await onEnd();
  }

  process.once("SIGTERM", () => {
    void onEnd();
  });

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    queue.push(line);
    void pump();
  });
  rl.on("close", () => {
    stdinEnded = true;
    void pump();
  });

  return new Promise<number>(() => {
    // onEnd calls process.exit
  });
}

function finishQuery(queried: IpcResponse): number {
  if (!queried.ok) {
    console.error(queried.error.message);
    return 1;
  }
  const result = queried.result as QueryBody;
  console.log(JSON.stringify(result, null, 2));
  if (result.completion === "error") {
    writeQueryFailure(result.diagnostics);
    return 1;
  }
  return 0;
}

const entry = process.argv[1];
const isDirect =
  entry !== undefined && import.meta.url === pathToFileURL(path.resolve(entry)).href;

if (isDirect) {
  runCommand(process.argv.slice(2))
    .then((code) => {
      process.exit(code);
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
