import * as vscode from "vscode";
import * as path from "node:path";
import { assertOpAllowed, type SessionContext } from "@data-pilot/core";
import { ChildProcessHost } from "@data-pilot/runtime-node";

let host: ChildProcessHost | undefined;

function trustContext(): SessionContext {
  const trusted = vscode.workspace.isTrusted;
  return { trustMode: trusted ? "trusted" : "untrusted-limited" };
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workerEntry = context.asAbsolutePath(path.join("out", "engine-worker.js"));

  const openCmd = vscode.commands.registerCommand(
    "dataPilot.openDataset",
    async () => {
      const ctx = trustContext();
      const blocked = assertOpAllowed(ctx, "openDataset");
      if (blocked) {
        void vscode.window.showErrorMessage(blocked.message);
        return;
      }

      const uri = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { Datasets: ["csv", "jsonl"] },
        title: "Open dataset (CSV or JSONL)",
      });
      if (!uri?.[0]) return;

      // Phase 0: prove child-process launch via process.execPath (no separate Node).
      try {
        if (!host) {
          host = new ChildProcessHost({
            workerEntry,
            trustMode: ctx.trustMode,
            execPath: process.execPath,
            rssLimitMb: vscode.workspace
              .getConfiguration("dataPilot")
              .get<number>("rssLimitMb", 256),
          });
          const { startupMs } = await host.start();
          const ping = await host.request("ping", undefined, { timeoutMs: 3000 });
          const rss =
            ping.ok && ping.result && typeof ping.result === "object"
              ? (ping.result as { rssMb?: number }).rssMb
              : undefined;
          void vscode.window.showInformationMessage(
            `Data Pilot engine ready (${startupMs.toFixed(0)} ms). Opened ${uri[0].fsPath}` +
              (rss !== undefined ? ` · child RSS ${rss} MiB` : "") +
              (ctx.trustMode === "untrusted-limited"
                ? " · untrusted limited mode"
                : ""),
          );
        } else {
          void vscode.window.showInformationMessage(
            `Dataset selected: ${uri[0].fsPath} (preview pipeline arrives in Phase 1)`,
          );
        }
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Data Pilot engine failed to start: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  );

  context.subscriptions.push(openCmd);
  context.subscriptions.push({
    dispose: () => {
      void host?.stop();
      host = undefined;
    },
  });
}

export async function deactivate(): Promise<void> {
  await host?.stop();
  host = undefined;
}
