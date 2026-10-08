import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "cli.ts");
const repo = path.resolve(here, "../../..");
const tiny = path.join(repo, "fixtures/sample/tiny.csv");

function run(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", cli, ...args], {
      cwd: repo,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("data-pilot bin", () => {
  it("preview of tiny.csv names id, country, balance, and name", async () => {
    const res = await run(["preview", tiny]);
    assert.equal(res.code, 0, res.stderr);
    const json = JSON.parse(res.stdout) as {
      handle: { columns: { name: string }[] };
      preview: { completion?: string };
    };
    assert.deepEqual(
      json.handle.columns.map((column) => column.name),
      ["id", "country", "balance", "name"],
    );
    assert.equal(json.preview.completion, "complete");
  });

  it("query without where exits 1", async () => {
    const res = await run(["query", tiny, 'country = "MX"']);
    assert.equal(res.code, 1);
    const json = JSON.parse(res.stdout) as { completion?: string };
    assert.equal(json.completion, "error");
    assert.match(res.stderr, /Unknown stage 'country'/);
    assert.match(res.stderr, /where/);
  });

  it("a query that matches nothing exits 0", async () => {
    const res = await run(["query", tiny, 'where country = "ZZ"']);
    assert.equal(res.code, 0, res.stderr);
    const json = JSON.parse(res.stdout) as { completion?: string; rowCountReturned?: number };
    assert.equal(json.completion, "complete");
    assert.equal(json.rowCountReturned, 0);
  });

  it("missing file argument exits 2", async () => {
    const res = await run(["preview"]);
    assert.equal(res.code, 2);
    assert.match(res.stderr, /Usage/);
  });

  it("help exits 2", async () => {
    const res = await run(["--help"]);
    assert.equal(res.code, 2);
    assert.match(res.stderr, /Usage/);
  });
});

function session(lines: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", cli], {
      cwd: repo,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    for (const line of lines) child.stdin.write(`${line}\n`);
    child.stdin.end();
  });
}

function replies(stdout: string): { id: string | null; ok: boolean; result?: Record<string, unknown>; error?: { message: string } }[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { id: string | null; ok: boolean; result?: Record<string, unknown>; error?: { message: string } });
}

describe("data-pilot session", () => {
  it("previews, keeps going after a bad query, then answers where", async () => {
    const res = await session([
      JSON.stringify({ id: "p", op: "preview", path: tiny }),
      "",
      JSON.stringify({ id: "bad", op: "query", path: tiny, dql: 'country = "MX"' }),
      JSON.stringify({ id: "ok", op: "query", path: tiny, dql: 'where country = "MX"' }),
    ]);
    assert.equal(res.code, 0, res.stderr);
    const rows = replies(res.stdout);
    assert.equal(rows.length, 3);
    assert.equal(rows[0]?.ok, true);
    const preview = rows[0]?.result as {
      handle: { datasetId: string; columns: { name: string }[] };
    };
    assert.deepEqual(
      preview.handle.columns.map((column) => column.name),
      ["id", "country", "balance", "name"],
    );
    assert.equal(rows[1]?.ok, true);
    assert.equal(rows[1]?.id, "bad");
    const failed = rows[1]?.result as { completion?: string; datasetId?: string };
    assert.equal(failed.completion, "error");
    assert.equal(failed.datasetId, preview.handle.datasetId);
    assert.equal(rows[2]?.ok, true);
    const passed = rows[2]?.result as { completion?: string; rowCountReturned?: number; datasetId?: string };
    assert.equal(passed.completion, "complete");
    assert.equal(passed.rowCountReturned, 2);
    assert.equal(passed.datasetId, preview.handle.datasetId);
  });

  it("rejects agentQuery and still answers the next preview", async () => {
    const res = await session([
      JSON.stringify({ id: "nope", op: "agentQuery", path: tiny }),
      "not-json",
      JSON.stringify({ id: "p", op: "preview", path: tiny }),
    ]);
    assert.equal(res.code, 0, res.stderr);
    const rows = replies(res.stdout);
    assert.equal(rows.length, 3);
    assert.equal(rows[0]?.ok, false);
    assert.match(rows[0]?.error?.message ?? "", /agentQuery/);
    assert.equal(rows[1]?.ok, false);
    assert.equal(rows[1]?.id, null);
    assert.equal(rows[2]?.ok, true);
    assert.equal(rows[2]?.id, "p");
  });

  it("close with nothing open returns an empty dataset", async () => {
    const res = await session([JSON.stringify({ id: "c", op: "close" })]);
    assert.equal(res.code, 0, res.stderr);
    const rows = replies(res.stdout);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.ok, true);
    assert.deepEqual(rows[0]?.result, { datasetId: null });
  });
});

function mcp(lines: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", cli, "mcp"], {
      cwd: repo,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    for (const line of lines) child.stdin.write(`${line}\n`);
    child.stdin.end();
  });
}

function rpc(id: number, method: string, params?: unknown): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    ...(params !== undefined ? { params } : {}),
  });
}

describe("data-pilot mcp", () => {
  it("lists tools, previews tiny.csv, and keeps going after a bad query", async () => {
    const res = await mcp([
      rpc(1, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      rpc(2, "tools/list"),
      rpc(3, "tools/call", { name: "preview", arguments: { path: tiny } }),
      rpc(4, "tools/call", { name: "query", arguments: { path: tiny, dql: 'country = "MX"' } }),
      rpc(5, "tools/call", { name: "query", arguments: { path: tiny, dql: 'where country = "MX"' } }),
    ]);
    assert.equal(res.code, 0, res.stderr);
    const rows = replies(res.stdout) as unknown as {
      id?: number;
      result?: {
        tools?: { name: string }[];
        content?: { text: string }[];
        isError?: boolean;
      };
    }[];
    assert.equal(rows.length, 5);
    assert.deepEqual(
      rows[1]?.result?.tools?.map((tool) => tool.name),
      ["preview", "describe", "query", "export", "edit"],
    );
    const preview = JSON.parse(rows[2]?.result?.content?.[0]?.text ?? "{}") as {
      handle: { datasetId: string; columns: { name: string }[] };
    };
    assert.equal(rows[2]?.result?.isError, false);
    assert.deepEqual(
      preview.handle.columns.map((column) => column.name),
      ["id", "country", "balance", "name"],
    );
    assert.equal(rows[3]?.result?.isError, true);
    const failed = JSON.parse(rows[3]?.result?.content?.[0]?.text ?? "{}") as {
      completion?: string;
      datasetId?: string;
    };
    assert.equal(failed.completion, "error");
    assert.equal(failed.datasetId, preview.handle.datasetId);
    assert.equal(rows[4]?.result?.isError, false);
    const passed = JSON.parse(rows[4]?.result?.content?.[0]?.text ?? "{}") as {
      completion?: string;
      rowCountReturned?: number;
      datasetId?: string;
    };
    assert.equal(passed.completion, "complete");
    assert.equal(passed.rowCountReturned, 2);
    assert.equal(passed.datasetId, preview.handle.datasetId);
  });

  it("rejects agentQuery and still previews", async () => {
    const res = await mcp([
      rpc(1, "tools/call", { name: "agentQuery", arguments: { path: tiny } }),
      rpc(2, "tools/call", { name: "preview", arguments: { path: tiny } }),
    ]);
    assert.equal(res.code, 0, res.stderr);
    const rows = replies(res.stdout) as unknown as { result?: { isError?: boolean; content?: { text: string }[] } }[];
    assert.equal(rows[0]?.result?.isError, true);
    assert.match(rows[0]?.result?.content?.[0]?.text ?? "", /agentQuery/);
    assert.equal(rows[1]?.result?.isError, false);
  });
});

describe("data-pilot export", () => {
  it("writes MX rows and leaves no file when the query does not parse", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "data-pilot-export-"));
    const out = path.join(dir, "mx.csv");
    const missing = path.join(dir, "no.csv");
    try {
      const ok = await run(["export", tiny, 'where country = "MX"', out]);
      assert.equal(ok.code, 0, ok.stderr);
      const json = JSON.parse(ok.stdout) as { path?: string; rowCount?: number; format?: string };
      assert.equal(json.path, out);
      assert.equal(json.rowCount, 2);
      assert.equal(json.format, "csv");
      const text = await readFile(out, "utf8");
      assert.match(text, /Ada/);
      assert.match(text, /Cam/);
      assert.doesNotMatch(text, /Bob/);

      const bad = await run(["export", tiny, 'country = "MX"', missing]);
      assert.equal(bad.code, 1);
      await assert.rejects(access(missing));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses to write the export onto the source file", async () => {
    const res = await run(["export", tiny, 'where country = "MX"', tiny]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /source file/);
  });

  it("exports through MCP", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "data-pilot-export-"));
    const out = path.join(dir, "mx.csv");
    try {
      const res = await mcp([
        rpc(1, "tools/call", {
          name: "export",
          arguments: { path: tiny, dql: 'where country = "MX"', out },
        }),
      ]);
      assert.equal(res.code, 0, res.stderr);
      const rows = replies(res.stdout) as unknown as { result?: { isError?: boolean; content?: { text: string }[] } }[];
      assert.equal(rows[0]?.result?.isError, false);
      const text = await readFile(out, "utf8");
      assert.match(text, /Ada/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("data-pilot edit", () => {
  it("previews a cell without writing, then apply changes that cell", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "data-pilot-edit-"));
    const copy = path.join(dir, "tiny.csv");
    await copyFile(tiny, copy);
    const before = await readFile(copy, "utf8");
    try {
      const preview = await run(["edit", copy, "0", "country", "CA"]);
      assert.equal(preview.code, 0, preview.stderr);
      const shown = JSON.parse(preview.stdout) as {
        oldRaw?: string;
        newRaw?: string;
        applied?: boolean;
        unifiedDiff?: string;
      };
      assert.equal(shown.oldRaw, "MX");
      assert.equal(shown.newRaw, "CA");
      assert.equal(shown.applied, false);
      assert.match(shown.unifiedDiff ?? preview.stdout, /MX/);
      assert.equal(await readFile(copy, "utf8"), before);

      const applied = await run(["edit", copy, "0", "country", "CA", "--apply"]);
      assert.equal(applied.code, 0, applied.stderr);
      const saved = JSON.parse(applied.stdout) as { applied?: boolean };
      assert.equal(saved.applied, true);
      const after = await readFile(copy, "utf8");
      assert.match(after, /CA/);
      assert.notEqual(after, before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("an unknown column exits 1 and leaves the file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "data-pilot-edit-"));
    const copy = path.join(dir, "tiny.csv");
    await copyFile(tiny, copy);
    const before = await readFile(copy, "utf8");
    try {
      const res = await run(["edit", copy, "0", "no-such", "ZZ"]);
      assert.equal(res.code, 1);
      assert.equal(await readFile(copy, "utf8"), before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("MCP edit without apply does not write", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "data-pilot-edit-"));
    const copy = path.join(dir, "tiny.csv");
    await copyFile(tiny, copy);
    const before = await readFile(copy, "utf8");
    try {
      const res = await mcp([
        rpc(1, "tools/call", {
          name: "edit",
          arguments: { path: copy, rowIndex: 0, column: "country", newRaw: "CA" },
        }),
      ]);
      assert.equal(res.code, 0, res.stderr);
      const rows = replies(res.stdout) as unknown as { result?: { isError?: boolean; content?: { text: string }[] } }[];
      assert.equal(rows[0]?.result?.isError, false);
      const body = JSON.parse(rows[0]?.result?.content?.[0]?.text ?? "{}") as { applied?: boolean; oldRaw?: string };
      assert.equal(body.applied, false);
      assert.equal(body.oldRaw, "MX");
      assert.equal(await readFile(copy, "utf8"), before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
