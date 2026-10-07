import * as path from "node:path";
import type * as vscode from "vscode";

const DATASET_EXT = new Set([".csv", ".jsonl", ".ndjson"]);

export function isDatasetFilePath(filePath: string): boolean {
  return DATASET_EXT.has(path.extname(filePath).toLowerCase());
}

export function isDatasetUri(uri: vscode.Uri): boolean {
  if (uri.scheme !== "file") return false;
  return isDatasetFilePath(uri.fsPath);
}
