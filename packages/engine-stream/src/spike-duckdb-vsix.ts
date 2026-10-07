/**
 * Phase 6 spike: pack a throwaway VSIX that includes @duckdb/node-api.
 * Install and package only under tmp/. Does not change workspace package.json files.
 *
 * Run from the repo root:
 *   npx tsx packages/engine-stream/src/spike-duckdb-vsix.ts
 */
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const workDir = path.join(repoRoot, "tmp", "duckdb-vsix-measure");
const reportPath = path.join(repoRoot, "docs", "spikes", "phase6-duckdb-vsix.md");
const productVsix = path.join(repoRoot, "tmp", "data-pilot.vsix");
const BUDGET_BYTES = 50 * 1024 * 1024;

const KNOWN_TARGETS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-arm64",
  "win32-x64",
  "alpine-arm64",
  "alpine-x64",
] as const;

function targetId(): string {
  return `${process.platform}-${process.arch}`;
}

function mib(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2);
}

async function fileSize(filePath: string): Promise<number | undefined> {
  try {
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch {
    return undefined;
  }
}

async function writeThrowaway(): Promise<void> {
  await fs.rm(workDir, { recursive: true, force: true });
  await fs.mkdir(workDir, { recursive: true });
  const manifest = {
    name: "data-pilot-duckdb-measure",
    displayName: "Data Pilot DuckDB measure",
    publisher: "data-pilot",
    version: "0.0.0",
    private: true,
    engines: { vscode: "^1.101.0" },
    activationEvents: ["onStartupFinished"],
    main: "./extension.js",
    dependencies: { "@duckdb/node-api": "*" },
  };
  await fs.writeFile(path.join(workDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.writeFile(path.join(workDir, ".npmrc"), "workspaces=false\n");
  await fs.writeFile(
    path.join(workDir, "extension.js"),
    "// Throwaway main. This spike packages DuckDB; it does not execute it.\n",
  );
  await fs.writeFile(path.join(workDir, ".vscodeignore"), "**/*.map\n");
}

async function installDuckdb(): Promise<void> {
  await execFileAsync(
    "npm",
    ["install", "--omit=dev", "--no-package-lock", "--workspaces=false", "--prefix", workDir],
    { cwd: workDir, env: process.env },
  );
}

async function readInstalledPackage(): Promise<{ version: string; license: string }> {
  const pkgPath = path.join(workDir, "node_modules", "@duckdb", "node-api", "package.json");
  const raw = await fs.readFile(pkgPath, "utf8");
  const parsed = JSON.parse(raw) as { version?: string; license?: string };
  return {
    version: parsed.version ?? "unknown",
    license: typeof parsed.license === "string" ? parsed.license : "unknown",
  };
}

async function packageThrowaway(target: string): Promise<string> {
  const out = path.join(workDir, "measure.vsix");
  const vsceBin = path.join(repoRoot, "node_modules", "@vscode", "vsce", "vsce");
  await fs.access(vsceBin, fsConstants.X_OK);
  await execFileAsync(
    vsceBin,
    [
      "package",
      "--dependencies",
      "--follow-symlinks",
      "--skip-license",
      "--allow-missing-repository",
      "--target",
      target,
      "--ignore-other-target-folders",
      "-o",
      out,
    ],
    { cwd: workDir },
  );
  return out;
}

async function assertNativeIncluded(vsixPath: string): Promise<string[]> {
  const { stdout } = await execFileAsync("unzip", ["-l", vsixPath]);
  const hits = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /duckdb\.(node|dylib|so|dll)\b/i.test(line));
  if (hits.length === 0) {
    throw new Error("Throwaway VSIX does not contain a DuckDB native binary");
  }
  return hits;
}

function decisionParagraph(bytes: number): string {
  const fits = bytes <= BUDGET_BYTES;
  const size = `${mib(bytes)} MiB`;
  if (!fits) {
    return `The throwaway VSIX is ${size}, over the 50 MiB cap. DuckDB is not adopted. Streaming stays the default engine.`;
  }
  return `The throwaway VSIX is ${size}, under the 50 MiB cap on this platform. This phase still does not adopt DuckDB. Streaming stays the default engine.`;
}

async function main(): Promise<void> {
  const target = targetId();
  if (!KNOWN_TARGETS.includes(target as (typeof KNOWN_TARGETS)[number])) {
    throw new Error(`Unsupported measure target ${target}`);
  }

  await writeThrowaway();
  await installDuckdb();
  const installed = await readInstalledPackage();
  const vsixPath = await packageThrowaway(target);
  const nativeLines = await assertNativeIncluded(vsixPath);
  const measureBytes = await fileSize(vsixPath);
  if (measureBytes === undefined) {
    throw new Error("Throwaway VSIX is missing after package");
  }
  const productBytes = await fileSize(productVsix);

  const rows = KNOWN_TARGETS.map((id) => {
    if (id === target) return `| ${id} | measured | ${measureBytes} | ${mib(measureBytes)} |`;
    return `| ${id} | not measured |  |  |`;
  });

  const productLine =
    productBytes === undefined
      ? "Product VSIX `tmp/data-pilot.vsix` was not present when this spike ran."
      : `Product VSIX \`tmp/data-pilot.vsix\`: **${productBytes} bytes** (${mib(productBytes)} MiB). Packaged with \`--no-dependencies\`; it does not include DuckDB.`;

  const md = `# Spike: DuckDB VSIX size (Phase 6)

**Measured:** ${new Date().toISOString()}
**Platform:** ${target}
**Package:** \`@duckdb/node-api@${installed.version}\`
**License:** ${installed.license}
**Budget:** ≤50 MiB per platform (D-002)

This install lived in \`tmp/duckdb-vsix-measure\` and is not a workspace dependency.

## This platform

| Artifact | Bytes | MiB |
|---|---:|---:|
| Throwaway VSIX (native included) | ${measureBytes} | ${mib(measureBytes)} |
| Product VSIX | ${productBytes ?? "absent"} | ${productBytes === undefined ? "" : mib(productBytes)} |

${productLine}

${decisionParagraph(measureBytes)}

Notices: DuckDB is MIT. \`NOTICE\` still says it is not bundled. A full MIT notice is required only if a later spec ships the binary.

## Platforms

| Target | Status | Bytes | MiB |
|---|---|---:|---:|
${rows.join("\n")}

Phase 0 estimates in \`streaming-vs-duckdb.md\` are not measurements for the rows above.

## Native entries in the throwaway VSIX

\`\`\`
${nativeLines.join("\n")}
\`\`\`
`;

  await fs.writeFile(reportPath, md, "utf8");
  console.log(
    JSON.stringify(
      {
        target,
        version: installed.version,
        license: installed.license,
        measureBytes,
        productBytes: productBytes ?? null,
        reportPath,
      },
      null,
      2,
    ),
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
