import * as path from "node:path";
import type * as vscode from "vscode";

const DATASET_EXT = new Set([".csv", ".jsonl", ".ndjson"]);

export function isDatasetFilePath(filePath: string): boolean {
  return DATASET_EXT.has(path.extname(filePath).toLowerCase());
}

/** CSV/JSONL paths already open as text tabs. Does not scan the workspace. */
export function datasetTabPaths(filePaths: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const filePath of filePaths) {
    const resolved = path.resolve(filePath);
    if (!isDatasetFilePath(resolved) || seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

export function isDatasetUri(uri: vscode.Uri): boolean {
  if (uri.scheme !== "file") return false;
  return isDatasetFilePath(uri.fsPath);
}
