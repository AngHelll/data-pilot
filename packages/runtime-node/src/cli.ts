#!/usr/bin/env node
/**
 * Headless bin: one-shot preview, describe, query, and export, an NDJSON session, or MCP.
 * A cell edit writes the source file only with --apply. Does not call agentQuery.
 *
 *   npm run data-pilot -- preview fixtures/sample/tiny.csv
 *   npm run data-pilot -- query fixtures/sample/tiny.csv 'where country = "MX"'
 *   npm run data-pilot -- export fixtures/sample/tiny.csv 'where country = "MX"' /tmp/mx.csv
 *   npm run data-pilot -- edit fixtures/sample/tiny.csv 0 country CA --apply
 *   npm run data-pilot
 *   npm run data-pilot -- mcp
 */

import path from "node:path";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import type { Diagnostic, IpcResponse } from "@data-pilot/contracts";
import { DatasetSession, resolveUserPath, type EngineResult, type OpenBody } from "./cli-engine.js";
import { SOURCE_CHANGED_MESSAGE, sourceStillMatches } from "./source-snapshot.js";
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
  data-pilot export <file> <dql> <out> [--format csv|jsonl] [--param name=value]...
  data-pilot edit <file> <row> <column> <value> [--apply]
  data-pilot
      Read NDJSON actions (preview, describe, query, close) on stdin.
  data-pilot mcp
      Serve preview, describe, query, export, and edit over MCP stdio.`);
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

interface ExportArtifactBody {
  format: "csv" | "jsonl";
  content: string;
  byteLength: number;
  rowCount: number;
  completion: string;
}

function parseExportFlags(args: string[]): {
  format?: "csv" | "jsonl";
  params: Record<string, string>;
  error: boolean;
} {
  const params: Record<string, string> = {};
  let format: "csv" | "jsonl" | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--format") {
      const value = args[++i];
      if (value !== "csv" && value !== "jsonl") return { params, error: true };
      format = value;
      continue;
    }
    if (arg === "--param" && args[i + 1]) {
      const raw = args[++i]!;
      const eq = raw.indexOf("=");
      if (eq <= 0) return { params, error: true };
      params[raw.slice(0, eq)] = raw.slice(eq + 1);
      continue;
    }
    return { params, error: true };
  }
  return { ...(format !== undefined ? { format } : {}), params, error: false };
}

function exportSummary(outPath: string, artifact: ExportArtifactBody) {
  return {
    path: outPath,
    format: artifact.format,
    rowCount: artifact.rowCount,
    byteLength: artifact.byteLength,
    completion: artifact.completion,
  };
}

async function runExport(args: string[]): Promise<number> {
  const file = args[0];
  const dql = args[1];
  const out = args[2];
  if (!file || !dql || !out) {
    usage();
    return 2;
  }
  const flags = parseExportFlags(args.slice(3));
  if (flags.error) {
    usage();
    return 2;
  }
  const source = resolveUserPath(file);
  const destination = resolveUserPath(out);
  if (source === destination) {
    console.error("Refusing to write the export onto the source file");
    return 1;
  }
  const engine = new DatasetSession();
  try {
    await engine.start();
    const outcome = await engine.exportQuery(file, dql, flags.params, flags.format);
    if (!outcome.ok) {
      console.error(outcome.message);
      return 1;
    }
    const artifact = outcome.result as ExportArtifactBody;
    if (typeof artifact.content !== "string") {
      console.error("exportResult did not return content");
      return 1;
    }
    await writeFile(destination, artifact.content, "utf8");
    console.log(JSON.stringify(exportSummary(destination, artifact), null, 2));
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return 1;
  } finally {
    await engine.shutdown();
  }
}

interface EditPreviewBody {
  path: string;
  rowIndex: number;
  column: string;
  oldRaw: string;
  newRaw: string;
  unifiedDiff: string;
  afterText?: string;
  sourceByteLength?: number;
  sourceSha256?: string;
}

function parseEditArgs(args: string[]): {
  file?: string;
  rowIndex?: number;
  column?: string;
  newRaw?: string;
  apply: boolean;
  error: boolean;
} {
  let apply = false;
  const positionals: string[] = [];
  for (const arg of args) {
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg.startsWith("--")) return { apply, error: true };
    positionals.push(arg);
  }
  const file = positionals[0];
  const rowRaw = positionals[1];
  const column = positionals[2];
  const newRaw = positionals[3];
  if (!file || rowRaw === undefined || !column || newRaw === undefined || positionals.length !== 4) {
    return { apply, error: true };
  }
  if (!/^\d+$/.test(rowRaw)) return { apply, error: true };
  return { file, rowIndex: Number(rowRaw), column, newRaw, apply, error: false };
}

function editSummary(preview: EditPreviewBody, applied: boolean) {
  return {
    path: preview.path,
    rowIndex: preview.rowIndex,
    column: preview.column,
    oldRaw: preview.oldRaw,
    newRaw: preview.newRaw,
    unifiedDiff: preview.unifiedDiff,
    applied,
  };
}

async function runEdit(args: string[]): Promise<number> {
  const parsed = parseEditArgs(args);
  if (parsed.error || !parsed.file || parsed.rowIndex === undefined || !parsed.column || parsed.newRaw === undefined) {
    usage();
    return 2;
  }
  const engine = new DatasetSession();
  try {
    await engine.start();
    const outcome = await engine.editCell(
      parsed.file,
      parsed.rowIndex,
      parsed.column,
      parsed.newRaw,
      parsed.apply,
    );
    if (!outcome.ok) {
      console.error(outcome.message);
      return 1;
    }
    const preview = outcome.result as EditPreviewBody;
    if (parsed.apply) {
      if (typeof preview.afterText !== "string") {
        console.error("editFixture did not return file text");
        return 1;
      }
      const destination = resolveUserPath(parsed.file);
      if (!(await sourceStillMatches(destination, preview))) {
        console.error(SOURCE_CHANGED_MESSAGE);
        return 1;
      }
      await writeFile(destination, preview.afterText, "utf8");
    }
    console.log(JSON.stringify(editSummary(preview, parsed.apply), null, 2));
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return 1;
  } finally {
    await engine.shutdown();
  }
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
  if (cmd === "export") return runExport(argv.slice(1));
  if (cmd === "edit") return runEdit(argv.slice(1));
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
  {
    name: "export",
    description: "Write a bounded DQL 0.1 result to a new file. Does not modify the source.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        dql: { type: "string" },
        out: { type: "string" },
        format: { type: "string", enum: ["csv", "jsonl"] },
        params: { type: "object", additionalProperties: { type: "string" } },
      },
      required: ["path", "dql", "out"],
    },
  },
  {
    name: "edit",
    description: "Preview a one-cell change. Writes the source file only when apply is true.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        rowIndex: { type: "integer", minimum: 0 },
        column: { type: "string" },
        newRaw: { type: "string" },
        apply: { type: "boolean" },
      },
      required: ["path", "rowIndex", "column", "newRaw"],
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

  async function callExport(id: string | number | null, args: Record<string, unknown>): Promise<void> {
    if (typeof args.path !== "string" || typeof args.dql !== "string" || typeof args.out !== "string") {
      toolResult(id, "export requires path, dql, and out", true);
      return;
    }
    if (args.path.length === 0 || args.out.length === 0) {
      toolResult(id, "export requires path, dql, and out", true);
      return;
    }
    let format: "csv" | "jsonl" | undefined;
    if (args.format !== undefined) {
      if (args.format !== "csv" && args.format !== "jsonl") {
        toolResult(id, "format must be csv or jsonl", true);
        return;
      }
      format = args.format;
    }
    const params = readParams(args.params);
    if (params === "bad") {
      toolResult(id, "params must be an object of strings", true);
      return;
    }
    const source = resolveUserPath(args.path);
    const destination = resolveUserPath(args.out);
    if (source === destination) {
      toolResult(id, "Refusing to write the export onto the source file", true);
      return;
    }
    const outcome = await engine.exportQuery(args.path, args.dql, params, format);
    if (!outcome.ok) {
      toolResult(id, outcome.message, true);
      if (outcome.fatal) await finish(1);
      return;
    }
    const artifact = outcome.result as ExportArtifactBody;
    if (typeof artifact.content !== "string") {
      toolResult(id, "exportResult did not return content", true);
      return;
    }
    try {
      await writeFile(destination, artifact.content, "utf8");
    } catch (err) {
      toolResult(id, err instanceof Error ? err.message : String(err), true);
      return;
    }
    toolResult(id, JSON.stringify(exportSummary(destination, artifact)), false);
  }

  async function callEdit(id: string | number | null, args: Record<string, unknown>): Promise<void> {
    if (typeof args.path !== "string" || args.path.length === 0) {
      toolResult(id, "edit requires path", true);
      return;
    }
    if (typeof args.rowIndex !== "number" || !Number.isInteger(args.rowIndex) || args.rowIndex < 0) {
      toolResult(id, "rowIndex must be an integer >= 0", true);
      return;
    }
    if (typeof args.column !== "string" || args.column.length === 0 || typeof args.newRaw !== "string") {
      toolResult(id, "edit requires column and newRaw", true);
      return;
    }
    if (args.apply !== undefined && typeof args.apply !== "boolean") {
      toolResult(id, "apply must be a boolean", true);
      return;
    }
    const apply = args.apply === true;
    const outcome = await engine.editCell(args.path, args.rowIndex, args.column, args.newRaw, apply);
    if (!outcome.ok) {
      toolResult(id, outcome.message, true);
      if (outcome.fatal) await finish(1);
      return;
    }
    const preview = outcome.result as EditPreviewBody;
    if (apply) {
      if (typeof preview.afterText !== "string") {
        toolResult(id, "editFixture did not return file text", true);
        return;
      }
      const destination = resolveUserPath(args.path);
      if (!(await sourceStillMatches(destination, preview))) {
        toolResult(id, SOURCE_CHANGED_MESSAGE, true);
        return;
      }
      try {
        await writeFile(destination, preview.afterText, "utf8");
      } catch (err) {
        toolResult(id, err instanceof Error ? err.message : String(err), true);
        return;
      }
    }
    toolResult(id, JSON.stringify(editSummary(preview, apply)), false);
  }

  async function callTool(id: string | number | null, name: string, args: Record<string, unknown>): Promise<void> {
    if (name === "compare" || name === "agentQuery") {
      toolResult(id, `Tool '${name}' is not available`, true);
      return;
    }
    if (name !== "preview" && name !== "describe" && name !== "query" && name !== "export" && name !== "edit") {
      toolResult(id, `Unknown tool '${name}'`, true);
      return;
    }
    if (typeof args.path !== "string" || args.path.length === 0) {
      toolResult(id, `${name} requires path`, true);
      return;
    }
    if (name === "export") {
      await callExport(id, args);
      return;
    }
    if (name === "edit") {
      await callEdit(id, args);
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
