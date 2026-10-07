#!/usr/bin/env node
/**
 * Headless preview / DQL CLI for local Phase 1–2 verification.
 *
 *   npm run preview -- fixtures/sample/tiny.csv
 *   npm run query -- fixtures/sample/tiny.csv 'where country = "MX" | take 10'
 */

import path from "node:path";
import { DatasetStore } from "@data-pilot/engine-stream";
import { DatasetService, QueryService } from "./index.js";

function usage(): never {
  console.error(`Usage:
  data-pilot preview <file.csv|file.jsonl>
  data-pilot query <file> <dql> [--param name=value]...
  data-pilot describe <file>`);
  process.exit(2);
}

/** Prefer npm's INIT_CWD so `npm run preview -- fixtures/...` works from repo root. */
function resolveUserPath(p: string): string {
  if (path.isAbsolute(p)) return p;
  const base = process.env.INIT_CWD ?? process.cwd();
  return path.resolve(base, p);
}

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

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === "-h" || cmd === "--help") usage();

  const store = new DatasetStore();
  const datasets = new DatasetService(store, "trusted");
  const queries = new QueryService(store, "trusted");

  try {
    if (cmd === "preview" || cmd === "describe") {
      const file = argv[1];
      if (!file) usage();
      const { handle, diagnostics } = await datasets.open(resolveUserPath(file));
      if (cmd === "describe") {
        console.log(JSON.stringify({ handle, diagnostics }, null, 2));
      } else {
        const result = await datasets.preview(handle.datasetId);
        console.log(
          JSON.stringify(
            {
              handle: {
                datasetId: handle.datasetId,
                format: handle.format,
                columns: handle.columns,
                revision: handle.revision,
              },
              preview: result,
            },
            null,
            2,
          ),
        );
      }
      datasets.close(handle.datasetId);
      return;
    }

    if (cmd === "query") {
      const file = argv[1];
      const dql = argv[2];
      if (!file || !dql) usage();
      const params = parseParamArgs(argv.slice(3));
      const { handle } = await datasets.open(resolveUserPath(file));
      const result = await queries.execute(handle.datasetId, dql, params);
      console.log(JSON.stringify(result, null, 2));
      datasets.close(handle.datasetId);
      if (result.completion === "error") process.exit(1);
      return;
    }

    usage();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    store.closeAll();
  }
}

main();
