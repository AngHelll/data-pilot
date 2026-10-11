import * as path from "node:path";
import { isDatasetFilePath } from "./dataset-uri";

/** Name index only. The host does not read these files. */
export const DATASET_INDEX_LIMIT = 200;
export const DATASET_INDEX_INCLUDE = "**/*.{csv,jsonl,ndjson}";
export const DATASET_INDEX_EXCLUDE = "**/{node_modules,.git,out,dist,tmp}/**";

export type DatasetCatalogEntry =
  | { kind: "file"; filePath: string }
  | { kind: "limit" };

/** Workspace names plus dataset tabs, one path each. A full search adds a limit row. */
export function datasetCatalog(input: {
  workspacePaths: readonly string[];
  tabPaths: readonly string[];
  hitLimit: boolean;
}): DatasetCatalogEntry[] {
  const seen = new Set<string>();
  const files: string[] = [];
  const add = (filePath: string): void => {
    const resolved = path.resolve(filePath);
    if (!isDatasetFilePath(resolved) || seen.has(resolved)) return;
    seen.add(resolved);
    files.push(resolved);
  };
  for (const filePath of input.workspacePaths) add(filePath);
  for (const filePath of input.tabPaths) add(filePath);
  files.sort((a, b) => a.localeCompare(b));
  const entries: DatasetCatalogEntry[] = files.map((filePath) => ({ kind: "file", filePath }));
  if (input.hitLimit) entries.push({ kind: "limit" });
  return entries;
}

export function datasetIndexLimitLabel(limit = DATASET_INDEX_LIMIT): string {
  return `List limited to ${limit} files`;
}
