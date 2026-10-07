import path from "node:path";
import { fileURLToPath } from "node:url";

/** Dev/spike helper — absolute path to the TypeScript worker entry. */
export function resolveTsWorkerEntry(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "engine-worker.ts",
  );
}
