import * as fs from "node:fs/promises";
import type { ExportArtifact } from "@data-pilot/contracts";
import * as vscode from "vscode";

/** Host-only path authorization: user picks destination via VS Code save dialog. */
export async function writeExportArtifact(
  artifact: ExportArtifact,
): Promise<string | undefined> {
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(artifact.suggestedBasename),
    filters:
      artifact.format === "jsonl"
        ? { JSONL: ["jsonl"], "All files": ["*"] }
        : { CSV: ["csv"], "All files": ["*"] },
    title: "Export query result",
  });
  if (!uri) return undefined;
  await fs.writeFile(uri.fsPath, artifact.content, "utf8");
  return uri.fsPath;
}
