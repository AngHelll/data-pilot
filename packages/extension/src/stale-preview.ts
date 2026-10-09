/** A preview that refused to read because the file changed after open. */
export function previewIsStale(
  diagnostics: readonly { code?: string }[] | undefined,
): boolean {
  return (diagnostics ?? []).some((item) => item.code === "stale-source");
}
