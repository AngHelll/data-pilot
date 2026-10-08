import { readFile, stat } from "node:fs/promises";
import { hashSourceText } from "@data-pilot/engine-stream";

export const SOURCE_CHANGED_MESSAGE = "Source file changed before apply; nothing written";

export async function sourceStillMatches(
  filePath: string,
  fingerprint: { sourceByteLength?: unknown; sourceSha256?: unknown },
): Promise<boolean> {
  if (
    typeof fingerprint.sourceByteLength !== "number" ||
    !Number.isInteger(fingerprint.sourceByteLength) ||
    fingerprint.sourceByteLength < 0 ||
    typeof fingerprint.sourceSha256 !== "string" ||
    fingerprint.sourceSha256.length !== 64
  ) {
    return false;
  }
  try {
    const info = await stat(filePath);
    if (info.size !== fingerprint.sourceByteLength) return false;
    const text = await readFile(filePath, "utf8");
    return hashSourceText(text) === fingerprint.sourceSha256;
  } catch {
    return false;
  }
}
