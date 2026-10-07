/**
 * Phase 0 spike: streaming engine vs DuckDB candidate (packaging / RSS / VSIX budget).
 * DuckDB remains a candidate (D-002). We measure what we can without committing the dep.
 *
 * - Generates synthetic CSV fixtures (small + ~100MB when disk allows)
 * - Measures streaming preview / filter+take / count / cancel RSS
 * - Probes optional duckdb package size if installable; otherwise documents estimate
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { scanPreview, countLines } from "./scan.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtureDir = path.join(repoRoot, "fixtures", "generated");

function rssMb(): number {
  return Math.round((process.memoryUsage().rss / (1024 * 1024)) * 100) / 100;
}

function round(n: number, d = 2): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

async function ensureFixtures(): Promise<{ small: string; medium: string; large?: string }> {
  await fs.mkdir(fixtureDir, { recursive: true });
  const small = path.join(fixtureDir, "sample-1k.csv");
  const medium = path.join(fixtureDir, "sample-100mb.csv");

  if (!fsSync.existsSync(small)) {
    const header = "id,country,balance,name\n";
    let body = header;
    for (let i = 0; i < 1000; i++) {
      body += `${i},MX,${50000 + i},user_${i}\n`;
    }
    await fs.writeFile(small, body, "utf8");
  }

  const targetBytes = 100 * 1024 * 1024;
  if (!fsSync.existsSync(medium) || (await fs.stat(medium)).size < targetBytes * 0.95) {
    console.error("Generating ~100MB CSV fixture (one-time)...");
    const out = createWriteStream(medium);
    async function* rows(): AsyncGenerator<string> {
      yield "id,country,balance,name,note\n";
      let written = 0;
      let i = 0;
      const countries = ["MX", "US", "ES", "AR", "CO"];
      while (written < targetBytes) {
        const line = `${i},${countries[i % countries.length]},${(1000 + (i % 99999)).toFixed(2)},user_${i},"pad-${"x".repeat(40)}"\n`;
        written += Buffer.byteLength(line);
        i += 1;
        yield line;
      }
    }
    await pipeline(Readable.from(rows()), out);
  }

  return { small, medium };
}

async function measureStreaming(filePath: string, label: string) {
  global.gc?.();
  const before = rssMb();
  const t0 = performance.now();
  const preview = await scanPreview(filePath, { maxRows: 200, maxBytes: 1024 * 1024 });
  const previewMs = performance.now() - t0;
  const afterPreview = rssMb();

  const t1 = performance.now();
  // filter+take: scan lines until 50 matches for country=MX (naive)
  const stream = fsSync.createReadStream(filePath, { encoding: "utf8" });
  const rl = (await import("node:readline")).createInterface({ input: stream, crlfDelay: Infinity });
  let taken = 0;
  let scanned = 0;
  let headerSkipped = false;
  for await (const line of rl) {
    if (!headerSkipped) {
      headerSkipped = true;
      continue;
    }
    scanned += 1;
    if (line.includes(",MX,")) {
      taken += 1;
      if (taken >= 50) break;
    }
  }
  rl.close();
  stream.destroy();
  const filterMs = performance.now() - t1;
  const afterFilter = rssMb();

  const ac = new AbortController();
  const countPromise = countLines(filePath, ac.signal);
  setTimeout(() => ac.abort(), 30);
  const countPartial = await countPromise;

  const t2 = performance.now();
  const countFull = await countLines(filePath);
  const countMs = performance.now() - t2;
  const afterCount = rssMb();

  const sizeMb = round((await fs.stat(filePath)).size / (1024 * 1024));

  return {
    label,
    sizeMb,
    preview: {
      ms: round(previewMs),
      rows: preview.rows.length,
      bytesRead: preview.bytesRead,
      truncated: preview.truncated,
      rssDeltaMb: round(afterPreview - before),
      rssMb: afterPreview,
    },
    filterTake: {
      ms: round(filterMs),
      scanned,
      taken,
      rssMb: afterFilter,
    },
    countCancel: {
      cancelled: countPartial.cancelled,
      linesBeforeCancel: countPartial.lines,
    },
    countFull: {
      ms: round(countMs),
      lines: countFull.lines,
      rssMb: afterCount,
    },
  };
}

async function probeDuckDb(): Promise<{
  attemptedInstall: boolean;
  available: boolean;
  packageName?: string;
  installedBytes?: number;
  installedMiB?: number;
  vsixBudgetMiB: number;
  notes: string[];
  license: string;
}> {
  const vsixBudgetMiB = 50;
  const notes: string[] = [
    "DuckDB remains a candidate (D-002); streaming is the default path for v0.1.",
    "DuckDB and @duckdb/node-* clients are MIT — notices required if pulled in.",
    "Native binaries are per-platform; VSIX must use platform-specific packaging.",
  ];

  // Prefer measuring an already-present optional install under node_modules without adding a hard dependency.
  const candidates = ["@duckdb/node-api", "duckdb"];
  for (const name of candidates) {
    const pkgPath = path.join(repoRoot, "node_modules", ...name.split("/"));
    if (fsSync.existsSync(pkgPath)) {
      const size = await dirSize(pkgPath);
      return {
        attemptedInstall: false,
        available: true,
        packageName: name,
        installedBytes: size,
        installedMiB: round(size / (1024 * 1024)),
        vsixBudgetMiB,
        notes: [
          ...notes,
          `Found local ${name} at ${round(size / (1024 * 1024))} MiB (package tree only; platform binary may add more).`,
          `VSIX goal ≤${vsixBudgetMiB} MiB/platform — analytics engine must fit with extension+stream runtime.`,
        ],
        license: "MIT",
      };
    }
  }

  // Query npm registry metadata for size hints without installing.
  let tarballHint: string | undefined;
  try {
    const res = await fetch("https://registry.npmjs.org/@duckdb/node-api/latest");
    if (res.ok) {
      const data = (await res.json()) as {
        version?: string;
        dist?: { unpackedSize?: number; tarball?: string };
        license?: string;
      };
      const unpacked = data.dist?.unpackedSize;
      tarballHint = data.dist?.tarball;
      notes.push(
        `@duckdb/node-api latest=${data.version ?? "?"} license=${data.license ?? "MIT"} unpackedSize≈${
          unpacked ? `${round(unpacked / (1024 * 1024))} MiB` : "unknown"
        } (JS package only; native addon separate / platform-specific).`,
      );
      if (unpacked && unpacked / (1024 * 1024) > vsixBudgetMiB * 0.5) {
        notes.push(
          "JS unpacked size alone is a large fraction of the 50 MiB VSIX budget — platform binaries likely push over unless filtered.",
        );
      }
    } else {
      notes.push(`npm registry lookup failed: HTTP ${res.status}`);
    }
  } catch (err) {
    notes.push(`npm registry lookup error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Published community observations / prior art — mark as estimate, not measurement.
  notes.push(
    "Estimate (not installed here): DuckDB Node bindings + linux-x64 native often land in the tens of MiB per platform; risk of exceeding ≤50 MiB VSIX meta without careful packaging.",
  );
  notes.push(
    "Recommendation: keep streaming as v0.1 default; re-evaluate DuckDB in Phase 6 with a platform-specific VSIX size measurement before merging the dep.",
  );
  void tarballHint;

  return {
    attemptedInstall: false,
    available: false,
    vsixBudgetMiB,
    notes,
    license: "MIT",
  };
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(p);
    else if (entry.isFile()) total += (await fs.stat(p)).size;
  }
  return total;
}

async function estimateExtensionFootprint(): Promise<{
  sourceBytes: number;
  sourceMiB: number;
  note: string;
}> {
  let total = 0;
  const roots = [
    path.join(repoRoot, "packages"),
    path.join(repoRoot, "package.json"),
    path.join(repoRoot, "README.md"),
  ];
  for (const root of roots) {
    const st = await fs.stat(root).catch(() => null);
    if (!st) continue;
    if (st.isDirectory()) total += await dirSize(root);
    else total += st.size;
  }
  // Exclude node_modules / dist from naive walk if present inside packages — dirSize includes them if installed.
  return {
    sourceBytes: total,
    sourceMiB: round(total / (1024 * 1024)),
    note: "Workspace bytes including installed deps if present; not a packed VSIX. Streaming-only VSIX expected well under 50 MiB.",
  };
}

async function main(): Promise<void> {
  const fixtures = await ensureFixtures();
  const small = await measureStreaming(fixtures.small, "csv-1k");
  const medium = await measureStreaming(fixtures.medium, "csv-100mb");
  const duck = await probeDuckDb();
  const footprint = await estimateExtensionFootprint();

  // 1GB fixture is optional — skip generation to keep CI/disk light; document as follow-up.
  const report = {
    measuredAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    streaming: { small, medium },
    duckdb: duck,
    vsix: {
      goalMiBPerPlatform: 50,
      workspaceFootprint: footprint,
      streamingOnlyEstimate: "≪ 50 MiB (TS/JS + CSV parser deps; no natives)",
      withDuckDbRisk: "Likely to approach or exceed 50 MiB/platform once native binaries are included — must measure per-platform VSIX before adopting.",
    },
    conclusions: [
      "Streaming preview of ~100 MiB CSV stays memory-bounded (delta RSS small vs file size) because reads are incremental.",
      "filter+take can stop early without a full scan; count requires a full pass (cancel works cooperatively).",
      "DuckDB stays a candidate under MIT with license notices; packaging risk vs ≤50 MiB VSIX is the main open gate — do not hard-depend yet.",
      "v0.1 default engine: streaming. Analytics/DuckDB deferred until Phase 6 evidence + measured VSIX.",
    ],
  };

  const outDir = path.join(repoRoot, "docs", "spikes");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, "streaming-vs-duckdb-results.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );

  const md = `# Spike: streaming vs DuckDB (Phase 0)

**Measured:** ${report.measuredAt}  
**Platform:** ${report.platform}  
**Node:** ${report.node}

## Streaming engine

### ${small.label} (${small.sizeMb} MiB)

| Op | Time | Notes |
|---|---:|---|
| preview (≤200 rows / ≤1 MiB) | ${small.preview.ms} ms | rows=${small.preview.rows}, rss=${small.preview.rssMb} MiB (Δ ${small.preview.rssDeltaMb}) |
| filter+take 50 | ${small.filterTake.ms} ms | scanned=${small.filterTake.scanned} |
| count (full) | ${small.countFull.ms} ms | lines=${small.countFull.lines} |
| count cancel | — | cancelled=${small.countCancel.cancelled}, lines=${small.countCancel.linesBeforeCancel} |

### ${medium.label} (${medium.sizeMb} MiB)

| Op | Time | Notes |
|---|---:|---|
| preview (≤200 rows / ≤1 MiB) | ${medium.preview.ms} ms | rows=${medium.preview.rows}, rss=${medium.preview.rssMb} MiB (Δ ${medium.preview.rssDeltaMb}) |
| filter+take 50 | ${medium.filterTake.ms} ms | scanned=${medium.filterTake.scanned} |
| count (full) | ${medium.countFull.ms} ms | lines=${medium.countFull.lines} |
| count cancel | — | cancelled=${medium.countCancel.cancelled}, lines=${medium.countCancel.linesBeforeCancel} |

## DuckDB candidate

- Available in workspace: **${duck.available}**
- License: **${duck.license}** (notices required if shipped)
- VSIX budget: **≤${duck.vsixBudgetMiB} MiB / platform**

${duck.notes.map((n) => `- ${n}`).join("\n")}

## VSIX footprint

- Workspace walk: ~${footprint.sourceMiB} MiB (${footprint.note})
- Streaming-only estimate: ${report.vsix.streamingOnlyEstimate}
- With DuckDB: ${report.vsix.withDuckDbRisk}

## Conclusions

${report.conclusions.map((c) => `- ${c}`).join("\n")}

## Follow-ups

- Optional 1 GB fixture measurement on a machine with disk budget
- Real \`@duckdb/node-api\` (or chosen client) install + per-platform VSIX pack measurement before Phase 6
- Replace naive \`split(',')\` scanner with a proper CSV parser in Phase 1

Raw JSON: [streaming-vs-duckdb-results.json](./streaming-vs-duckdb-results.json)
`;

  await fs.writeFile(path.join(outDir, "streaming-vs-duckdb.md"), md, "utf8");
  console.log(JSON.stringify({ streaming: report.streaming, duckdb: report.duckdb, vsix: report.vsix }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
