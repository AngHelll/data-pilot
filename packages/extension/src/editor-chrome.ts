/** Visible chrome for the dataset editor. No vscode. */

const TAB_LIMIT = 32;
const PILL_DISTINCT_MAX = 6;
const PILL_VALUE_LIMIT = 16;

export function clipLabel(text: string, limit: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  if (single.length <= limit) return single;
  return `${single.slice(0, limit - 1)}…`;
}

/** Result tab. A name wins. Otherwise a short query. Otherwise Result. */
export function resultTabLabel(name: string | undefined, dql: string | undefined): string {
  const named = name?.trim();
  if (named) return clipLabel(named, TAB_LIMIT);
  if (dql?.trim()) return clipLabel(dql, TAB_LIMIT);
  return "Result";
}

export type ActivityKind = "preview" | "query";
export type ActivityOutcome = "complete" | "cut-short" | "failed";

export function activityOutcome(
  kind: ActivityKind,
  completion: string | undefined,
  failed: boolean,
): ActivityOutcome {
  if (failed || completion === "error") return kind === "query" ? "failed" : "cut-short";
  if (completion === "complete") return "complete";
  return "cut-short";
}

/** Status-bar sentence. Milliseconds appear only when the host timed the call. */
export function activityText(
  kind: ActivityKind,
  outcome: ActivityOutcome,
  elapsedMs?: number,
): string {
  const head =
    kind === "preview"
      ? outcome === "complete"
        ? "Preview complete"
        : "Preview cut short"
      : outcome === "complete"
        ? "Query complete"
        : outcome === "failed"
          ? "Query failed"
          : "Query cut short";
  if (typeof elapsedMs === "number" && Number.isFinite(elapsedMs) && elapsedMs >= 0) {
    return `${head} · ${Math.round(elapsedMs)} ms`;
  }
  return head;
}

function gridEnding(completion: string): "Complete" | "Cut short" | "Cancelled" | "Error" {
  if (completion === "complete") return "Complete";
  if (completion === "cancelled") return "Cancelled";
  if (completion === "error") return "Error";
  return "Cut short";
}

/** Footer for one grid. The range counts returned rows, not the file. */
export function gridFooter(input: {
  surface: "Preview" | "Result";
  rowCountReturned: number;
  completion: string;
  elapsedMs?: number;
}): string {
  const ms =
    typeof input.elapsedMs === "number" && Number.isFinite(input.elapsedMs) && input.elapsedMs >= 0
      ? ` · ${Math.round(input.elapsedMs)} ms`
      : "";
  const status = `${input.surface} · ${input.rowCountReturned} rows returned · ${gridEnding(input.completion)}${ms}`;
  if (input.rowCountReturned <= 0) return status;
  const n = input.rowCountReturned;
  return `${status}\nShowing 1–${n} of ${n}`;
}

/** Visible type name. The engine token stays lowercase. */
export function typeLabel(inferredType: string): string {
  if (!inferredType) return "";
  return inferredType.charAt(0).toUpperCase() + inferredType.slice(1);
}

export function columnPresentation(input: {
  inferredType: string;
  distinctCountSample?: number;
  seenValues?: readonly string[];
}): { pill: boolean; align: "start" | "end" } {
  if (input.inferredType === "integer" || input.inferredType === "decimal") {
    return { pill: false, align: "end" };
  }
  if (input.inferredType === "boolean") return { pill: true, align: "start" };
  if (input.inferredType !== "string") return { pill: false, align: "start" };
  const count = input.distinctCountSample;
  if (count === undefined || count < 1 || count > PILL_DISTINCT_MAX) {
    return { pill: false, align: "start" };
  }
  const distinct = [...new Set(input.seenValues ?? [])];
  if (distinct.length !== count) return { pill: false, align: "start" };
  if (distinct.some((value) => value.length > PILL_VALUE_LIMIT)) {
    return { pill: false, align: "start" };
  }
  return { pill: true, align: "start" };
}
