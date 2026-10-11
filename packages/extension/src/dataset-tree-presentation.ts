import * as path from "node:path";

/** Visible Datasets row. The session id stays in the tooltip. */
export function datasetTreePresentation(
  filePath: string,
  datasetId: string | undefined,
  workspaceRoot: string | undefined,
): {
  label: string;
  description: string;
  tooltip: string;
} {
  return {
    label: path.basename(filePath),
    description: datasetRowDirectory(filePath, workspaceRoot),
    tooltip: datasetId ? `${filePath}\n${datasetId}` : filePath,
  };
}

/** Directory relative to the workspace. Outside it, the parent folder name. */
export function datasetRowDirectory(filePath: string, workspaceRoot: string | undefined): string {
  const resolved = path.resolve(filePath);
  if (workspaceRoot) {
    const relative = path.relative(path.resolve(workspaceRoot), resolved);
    const outside = relative.startsWith("..") || path.isAbsolute(relative);
    if (!outside) {
      const dir = path.dirname(relative);
      if (dir === ".") return "";
      return dir.split(path.sep).join("/");
    }
  }
  return path.basename(path.dirname(resolved));
}
