import * as path from "node:path";

/** Visible Datasets row. The session id stays in the tooltip. */
export function datasetTreePresentation(filePath: string, datasetId: string): {
  label: string;
  description: string;
  tooltip: string;
} {
  return {
    label: path.basename(filePath),
    description: "",
    tooltip: `${filePath}\n${datasetId}`,
  };
}
