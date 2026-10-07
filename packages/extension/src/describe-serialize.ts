import type { DatasetHandle, Diagnostic } from "@data-pilot/contracts";
import type { SerializedDescribe } from "./webview/messages";

export function serializeDescribe(handle: DatasetHandle): SerializedDescribe {
  return {
    path: handle.revision.path,
    format: handle.format,
    sizeBytes: handle.revision.sizeBytes,
    mtimeMs: handle.revision.mtimeMs,
    revisionId: handle.revision.revisionId,
    columns: handle.columns,
  };
}

/** Ingest / parse diagnostics (open + preview), deduped by code+message. */
export function mergeIngestDiagnostics(
  open: Diagnostic[],
  preview: Diagnostic[],
): Diagnostic[] {
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  for (const d of [...open, ...preview]) {
    const key = `${d.code}\0${d.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

export function planLooksRunnable(diagnostics: Diagnostic[]): boolean {
  return !diagnostics.some((d) => d.severity === "error");
}
