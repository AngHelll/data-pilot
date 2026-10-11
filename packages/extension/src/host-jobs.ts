import { clipLabel, type ActivityOutcome } from "./editor-chrome";

/** Jobs kept for this window. Newest first. */
export const MAX_HOST_JOBS = 20;

const LABEL_LIMIT = 32;

export type HostJobKind = "preview" | "query";
export type HostJobStatus = "running" | "completed" | "cancelled" | "failed";

export interface HostJob {
  id: string;
  kind: HostJobKind;
  filePath: string;
  fileName: string;
  dql?: string;
  name?: string;
  status: HostJobStatus;
  elapsedMs?: number;
}

export interface HostJobStart {
  kind: HostJobKind;
  filePath: string;
  fileName: string;
  dql?: string;
  name?: string;
}

export interface HostJobFinish {
  outcome: ActivityOutcome;
  elapsedMs?: number;
  cancelled?: boolean;
}

export type HostJobOpen = "result" | "data" | "none";

/**
 * Status bar "complete" is Completed. "failed" and "cut short" are not a
 * finished scan, and this list has no fifth label, so both show Failed.
 * Cancel wins: the user stopped the query `cancelActiveQuery` can stop.
 */
export function hostJobTerminal(
  outcome: ActivityOutcome,
  cancelled: boolean,
): Exclude<HostJobStatus, "running"> {
  if (cancelled) return "cancelled";
  if (outcome === "complete") return "completed";
  return "failed";
}

/** Keep the newest rows. The caller passes newest first. */
export function retainHostJobs(newestFirst: readonly HostJob[]): HostJob[] {
  return newestFirst.slice(0, MAX_HOST_JOBS);
}

export function hostJobPresentation(job: HostJob): {
  label: string;
  description: string;
  tooltip: string;
} {
  const label =
    job.kind === "preview"
      ? `Preview · ${job.fileName}`
      : `Query · ${clipLabel(job.name?.trim() || job.dql || "", LABEL_LIMIT)}`;
  return {
    label,
    description: hostJobDescription(job),
    tooltip: job.kind === "query" && job.dql ? `${job.filePath}\n${job.dql}` : job.filePath,
  };
}

export function hostJobOpen(job: HostJob): HostJobOpen {
  if (job.status !== "completed") return "none";
  return job.kind === "query" ? "result" : "data";
}

/** Only the query `cancelActiveQuery` is already tracking. */
export function hostJobCancellable(job: HostJob, activeQueryId: string | undefined): boolean {
  return job.kind === "query" && job.status === "running" && job.id === activeQueryId;
}

function hostJobDescription(job: HostJob): string {
  if (job.status === "running") return "Running";
  if (job.status === "cancelled") return "Cancelled";
  if (job.status === "failed") return "Failed";
  if (
    typeof job.elapsedMs === "number" &&
    Number.isFinite(job.elapsedMs) &&
    job.elapsedMs >= 0
  ) {
    return `Completed · ${Math.round(job.elapsedMs)} ms`;
  }
  return "Completed";
}

function copyJob(job: HostJob, status: HostJobStatus, elapsedMs?: number): HostJob {
  const next: HostJob = {
    id: job.id,
    kind: job.kind,
    filePath: job.filePath,
    fileName: job.fileName,
    status,
  };
  if (job.dql !== undefined) next.dql = job.dql;
  if (job.name !== undefined) next.name = job.name;
  if (elapsedMs !== undefined) next.elapsedMs = elapsedMs;
  return next;
}

/** In-memory job list for one window. Nothing here is written to disk. */
export class HostJobLog {
  private rows: HostJob[] = [];
  private seq = 0;
  private activeQueryId: string | undefined;
  private readonly listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  list(): readonly HostJob[] {
    return this.rows;
  }

  activeQueryJobId(): string | undefined {
    return this.activeQueryId;
  }

  begin(start: HostJobStart): HostJob {
    const job: HostJob = {
      id: `job-${++this.seq}`,
      kind: start.kind,
      filePath: start.filePath,
      fileName: start.fileName,
      status: "running",
    };
    if (start.dql !== undefined) job.dql = start.dql;
    if (start.name !== undefined) job.name = start.name;
    this.rows = retainHostJobs([job, ...this.rows]);
    if (job.kind === "query") this.activeQueryId = job.id;
    else if (this.activeQueryId && !this.rows.some((row) => row.id === this.activeQueryId)) {
      this.activeQueryId = undefined;
    }
    this.emit();
    return job;
  }

  /** A row that already left Running stays as it is. Cancel is not overwritten. */
  finish(id: string, input: HostJobFinish): void {
    const current = this.rows.find((row) => row.id === id);
    if (!current || current.status !== "running") return;
    const status = hostJobTerminal(input.outcome, input.cancelled === true);
    const elapsed =
      status === "completed" &&
      typeof input.elapsedMs === "number" &&
      Number.isFinite(input.elapsedMs) &&
      input.elapsedMs >= 0
        ? input.elapsedMs
        : undefined;
    this.rows = this.rows.map((row) => (row.id === id ? copyJob(row, status, elapsed) : row));
    if (this.activeQueryId === id) this.activeQueryId = undefined;
    this.emit();
  }

  /** Mark that query Cancelled. False when this row is not the one the host can stop. */
  cancel(id: string): boolean {
    if (this.activeQueryId !== id) return false;
    const current = this.rows.find((row) => row.id === id);
    if (!current || !hostJobCancellable(current, this.activeQueryId)) return false;
    this.rows = this.rows.map((row) => (row.id === id ? copyJob(row, "cancelled") : row));
    this.activeQueryId = undefined;
    this.emit();
    return true;
  }

  cancelActive(): boolean {
    if (!this.activeQueryId) return false;
    return this.cancel(this.activeQueryId);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
