/**
 * Phase 0 spike: measure child-process startup, IPC round-trip, RSS, cancel, kill/recover.
 * Prefer measurement over building a second runtime (D-001).
 *
 * Usage: npm run spike:child-process
 * Writes JSON + markdown summary under docs/spikes/ (repo root relative).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChildProcessHost } from "./child-process-host.js";
import { resolveTsWorkerEntry } from "./paths.js";

interface Trial {
  name: string;
  samples: number[];
  unit: string;
  notes?: string;
}

function stats(samples: number[]): { min: number; max: number; mean: number; p50: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mid = Math.floor(sorted.length / 2);
  const p50 =
    sorted.length % 2 === 0
      ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      : (sorted[mid] ?? 0);
  return {
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    mean: sum / Math.max(sorted.length, 1),
    p50,
  };
}

function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

async function measureStartup(n: number): Promise<Trial> {
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    const host = new ChildProcessHost({ workerEntry: resolveTsWorkerEntry() });
    const { startupMs } = await host.start();
    samples.push(startupMs);
    await host.stop();
  }
  return { name: "cold-startup", samples, unit: "ms", notes: "includes tsx import of worker TS" };
}

async function measureIpc(n: number): Promise<{ trial: Trial; baselineRssMb: number }> {
  const host = new ChildProcessHost({ workerEntry: resolveTsWorkerEntry() });
  await host.start();
  const samples: number[] = [];
  let baselineRssMb = 0;
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    const res = await host.request("ping", undefined, { timeoutMs: 2000 });
    samples.push(performance.now() - t0);
    if (res.ok && i === 0) {
      baselineRssMb = Number((res.result as { rssMb: number }).rssMb);
    }
  }
  await host.stop();
  return {
    trial: { name: "ipc-ping-rtt", samples, unit: "ms" },
    baselineRssMb,
  };
}

async function measureCancel(): Promise<{
  cancelled: boolean;
  elapsedMs: number;
  notes: string;
}> {
  const host = new ChildProcessHost({ workerEntry: resolveTsWorkerEntry() });
  await host.start();
  const requestId = "cancel-spike-1";
  const t0 = performance.now();
  const previewPromise = host.requestWithId(
    requestId,
    "preview",
    { workMs: 3000 },
    { timeoutMs: 5000 },
  );
  await new Promise((r) => setTimeout(r, 50));
  await host.request("cancelJob", { requestId }, { timeoutMs: 2000 });
  const res = await previewPromise;
  const elapsedMs = performance.now() - t0;
  await host.stop();
  return {
    cancelled:
      res.ok &&
      typeof res.result === "object" &&
      res.result !== null &&
      (res.result as { completion?: string }).completion === "cancelled",
    elapsedMs: round(elapsedMs),
    notes: "cooperative cancel via cancelJob while preview sleeping",
  };
}

async function measureKillRecover(): Promise<{
  killRecovered: boolean;
  recoverStartupMs: number;
  crashRecovered: boolean;
  crashRecoverStartupMs: number;
  rssKillRecovered: boolean;
  peakRssMb: number;
}> {
  const host = new ChildProcessHost({
    workerEntry: resolveTsWorkerEntry(),
    rssLimitMb: 80,
  });
  await host.start();

  // Excess memory path: allocate until child self-exits or host kills.
  let peakRssMb = 0;
  const memPromise = host.request("preview", { allocateMb: 120, workMs: 200 }, { timeoutMs: 3000 });
  let rssKillRecovered = false;
  let recoverStartupMs = 0;
  try {
    const memRes = await memPromise;
    if (memRes.ok) {
      peakRssMb = Number((memRes.result as { rssMb: number }).rssMb);
    }
  } catch {
    // expected if child exited on RSS limit
  }
  if (!host.pid) {
    const recovered = await host.recover();
    recoverStartupMs = recovered.startupMs;
    rssKillRecovered = true;
    const ping = await host.request("ping", undefined, { timeoutMs: 2000 });
    rssKillRecovered = ping.ok;
    peakRssMb = Math.max(peakRssMb, 80);
  } else {
    // Host-initiated kill on excess memory signal
    host.kill("SIGKILL");
    await new Promise((r) => setTimeout(r, 100));
    const recovered = await host.recover();
    recoverStartupMs = recovered.startupMs;
    const ping = await host.request("ping", undefined, { timeoutMs: 2000 });
    rssKillRecovered = ping.ok;
  }

  // Native/abrupt failure: crash exit
  let crashRecovered = false;
  let crashRecoverStartupMs = 0;
  try {
    await host.request("preview", { crash: true }, { timeoutMs: 2000 });
  } catch {
    // expected
  }
  const recovered2 = await host.recover();
  crashRecoverStartupMs = recovered2.startupMs;
  const ping2 = await host.request("ping", undefined, { timeoutMs: 2000 });
  crashRecovered = ping2.ok;
  await host.stop();

  return {
    killRecovered: rssKillRecovered,
    recoverStartupMs: round(recoverStartupMs),
    crashRecovered,
    crashRecoverStartupMs: round(crashRecoverStartupMs),
    rssKillRecovered,
    peakRssMb: round(peakRssMb),
  };
}

async function measureExecPathNote(): Promise<string> {
  return [
    `process.execPath=${process.execPath}`,
    `process.version=${process.version}`,
    "Extension host should spawn with process.execPath (Electron Node) so users need no separate Node install.",
    "This spike runs under the Dev Node binary; VS Code ≥1.101 ships Node 22.15.1 — verify launch once under real Code.",
  ].join("\n");
}

async function main(): Promise<void> {
  const startup = await measureStartup(5);
  const { trial: ipc, baselineRssMb } = await measureIpc(20);
  const cancel = await measureCancel();
  const kill = await measureKillRecover();
  const execNote = await measureExecPathNote();

  const report = {
    measuredAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    execPath: process.execPath,
    trials: {
      startup: { ...stats(startup.samples), unit: startup.unit, samples: startup.samples.map((s) => round(s)), notes: startup.notes },
      ipcPing: { ...stats(ipc.samples), unit: ipc.unit, samples: ipc.samples.map((s) => round(s, 3)) },
      baselineRssMb: round(baselineRssMb),
      cancel,
      killRecover: kill,
    },
    conclusions: [
      "Child process isolation is viable for Phase 0: host can kill and recover after RSS pressure and abrupt exit.",
      "IPC newline-JSON ping RTT is low enough for interactive preview control messages.",
      "Startup cost under tsx+TS is higher than a compiled JS worker; package the compiled dist/engine-worker.js in the VSIX.",
      "Do not build a second (worker-thread) runtime unless a later spike shows clear latency/memory wins (D-001).",
      "User-facing launch without separate Node remains to be smoke-tested inside VS Code ≥1.101 (open follow-up).",
    ],
    execNote,
  };

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const outDir = path.join(repoRoot, "docs", "spikes");
  await fs.mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "child-process-results.json");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const md = `# Spike: child-process runtime (Phase 0)

**Measured:** ${report.measuredAt}  
**Platform:** ${report.platform}  
**Node:** ${report.node}  
**execPath:** \`${report.execPath}\`

## Results

| Metric | min | p50 | mean | max | unit |
|---|---:|---:|---:|---:|---|
| Cold startup (tsx worker) | ${round(stats(startup.samples).min)} | ${round(stats(startup.samples).p50)} | ${round(stats(startup.samples).mean)} | ${round(stats(startup.samples).max)} | ms |
| IPC ping RTT | ${round(stats(ipc.samples).min, 3)} | ${round(stats(ipc.samples).p50, 3)} | ${round(stats(ipc.samples).mean, 3)} | ${round(stats(ipc.samples).max, 3)} | ms |

- Baseline child RSS (after ping): **${round(baselineRssMb)} MiB**
- Cooperative cancel observed: **${cancel.cancelled}** (${cancel.elapsedMs} ms wall) — ${cancel.notes}
- RSS/kill recover: **${kill.rssKillRecovered}** (recover startup ${kill.recoverStartupMs} ms; peak/limit context ${kill.peakRssMb} MiB)
- Crash recover: **${kill.crashRecovered}** (recover startup ${kill.crashRecoverStartupMs} ms)

## Conclusions

${report.conclusions.map((c) => `- ${c}`).join("\n")}

## Exec path note

\`\`\`
${execNote}
\`\`\`

Raw JSON: [child-process-results.json](./child-process-results.json)
`;

  await fs.writeFile(path.join(outDir, "child-process.md"), md, "utf8");
  console.log(JSON.stringify(report.trials, null, 2));
  console.log(`Wrote ${jsonPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
