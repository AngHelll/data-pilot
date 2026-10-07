import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Host-only replace of an already-open dataset. The engine child never writes this path. */
export async function replaceOpenDatasetFile(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.data-pilot-edit-${process.pid}-${Date.now()}.tmp`);
  try {
    await fs.writeFile(tmp, content, "utf8");
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}
