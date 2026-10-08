import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");
const packages = path.resolve(__dirname, "..");

const alias = {
  "@data-pilot/contracts": path.join(packages, "contracts/src/index.ts"),
  "@data-pilot/dql": path.join(packages, "dql/src/index.ts"),
  "@data-pilot/core": path.join(packages, "core/src/index.ts"),
  // Bundle host only — avoid pulling import.meta path helpers into the VSIX host.
  "@data-pilot/runtime-node": path.join(
    packages,
    "runtime-node/src/child-process-host.ts",
  ),
};

async function bundleWorker() {
  await esbuild.build({
    entryPoints: [path.join(packages, "runtime-node/src/engine-worker.ts")],
    bundle: true,
    outfile: path.resolve(__dirname, "out/engine-worker.js"),
    platform: "node",
    format: "cjs",
    target: "node22",
    alias,
    sourcemap: true,
  });
}

async function bundleExtension() {
  const options = {
    entryPoints: [path.resolve(__dirname, "src/extension.ts")],
    bundle: true,
    outfile: path.resolve(__dirname, "out/extension.js"),
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["vscode"],
    alias,
    sourcemap: true,
  };
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
  } else {
    await esbuild.build(options);
  }
}

await bundleWorker();
await bundleExtension();
console.log("extension + engine-worker bundled → out/");
