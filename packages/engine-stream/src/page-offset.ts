/** A bad offset is rejected before any scan. It is not a fourth row ceiling. */
export const MAX_PAGE_OFFSET = 10_000;

export function pageOffsetError(offset: number): string | undefined {
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_PAGE_OFFSET) {
    return `Page offset must be an integer from 0 to ${MAX_PAGE_OFFSET}`;
  }
  return undefined;
}

/** `fetchPage` is a preview window. A DQL payload is rejected before a scan. */
export function fetchPagePayloadError(payload: {
  dql?: unknown;
  offset?: unknown;
}): string | undefined {
  if (typeof payload.dql === "string") return "fetchPage does not run a query";
  if (typeof payload.offset !== "number") return "fetchPage requires an offset";
  return pageOffsetError(payload.offset);
}
