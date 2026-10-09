/** Stable chart color for an open dataset. Same path, same token. No vscode. */

export const DATASET_COLOR_TOKENS = [
  "charts.blue",
  "charts.green",
  "charts.orange",
  "charts.purple",
  "charts.red",
  "charts.yellow",
] as const;

export type DatasetColorToken = (typeof DATASET_COLOR_TOKENS)[number];

export function datasetColorToken(filePath: string): DatasetColorToken {
  const key = filePath.replace(/\\/g, "/");
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return DATASET_COLOR_TOKENS[(hash >>> 0) % DATASET_COLOR_TOKENS.length]!;
}
