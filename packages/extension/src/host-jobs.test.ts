import assert from "node:assert/strict";
import test from "node:test";
import {
  HostJobLog,
  MAX_HOST_JOBS,
  hostJobCancellable,
  hostJobOpen,
  hostJobPresentation,
  hostJobTerminal,
  retainHostJobs,
  type HostJob,
} from "./host-jobs.js";

function job(over: Partial<HostJob> & Pick<HostJob, "id" | "kind" | "status">): HostJob {
  return {
    filePath: "/data/users.csv",
    fileName: "users.csv",
    ...over,
  };
}

test("the 21st job drops the oldest", () => {
  const rows: HostJob[] = [];
  for (let i = 1; i <= MAX_HOST_JOBS + 1; i++) {
    rows.unshift(job({ id: `job-${i}`, kind: "preview", status: "completed" }));
  }
  const kept = retainHostJobs(rows);
  assert.equal(kept.length, MAX_HOST_JOBS);
  assert.equal(kept[0]?.id, "job-21");
  assert.equal(
    kept.some((row) => row.id === "job-1"),
    false,
  );

  const log = new HostJobLog();
  for (let i = 0; i < MAX_HOST_JOBS + 1; i++) {
    log.begin({ kind: "preview", filePath: `/data/${i}.csv`, fileName: `${i}.csv` });
  }
  assert.equal(log.list().length, MAX_HOST_JOBS);
  assert.equal(log.list()[0]?.fileName, "20.csv");
  assert.equal(
    log.list().some((row) => row.fileName === "0.csv"),
    false,
  );
});

test("a named query is labeled, and an unnamed one clips the DQL", () => {
  const named = hostJobPresentation(
    job({
      id: "job-1",
      kind: "query",
      status: "completed",
      name: "Active MX users",
      dql: 'where country = "MX"',
      elapsedMs: 84,
    }),
  );
  assert.equal(named.label, "Query · Active MX users");
  assert.equal(named.description, "Completed · 84 ms");

  const unnamed = hostJobPresentation(
    job({
      id: "job-2",
      kind: "query",
      status: "running",
      dql: 'where country = "MX" and status = "ACTIVE"',
    }),
  );
  assert.equal(unnamed.label, 'Query · where country = "MX" and status…');
  assert.equal(unnamed.description, "Running");
});

test("a preview is named by the file, and an unmeasured completion has no 0 ms", () => {
  const shown = hostJobPresentation(
    job({ id: "job-3", kind: "preview", status: "completed", fileName: "tiny.csv" }),
  );
  assert.equal(shown.label, "Preview · tiny.csv");
  assert.equal(shown.description, "Completed");
  assert.equal(shown.description.includes("0 ms"), false);
  assert.equal(shown.description.includes("ms"), false);
});

test("labels and tooltips do not show a protocol id", () => {
  const shown = hostJobPresentation(
    job({
      id: "ipc-request-77",
      kind: "query",
      status: "failed",
      dql: 'where country = "MX"',
      filePath: "/data/users.csv",
    }),
  );
  const visible = `${shown.label}\n${shown.description}\n${shown.tooltip}`;
  assert.equal(visible.includes("ipc-request-77"), false);
  assert.equal(shown.tooltip, '/data/users.csv\nwhere country = "MX"');
});

test("cancel applies only to the active query", () => {
  const running = job({ id: "job-9", kind: "query", status: "running" });
  const other = job({ id: "job-8", kind: "query", status: "running" });
  const preview = job({ id: "job-7", kind: "preview", status: "running" });
  assert.equal(hostJobCancellable(running, "job-9"), true);
  assert.equal(hostJobCancellable(other, "job-9"), false);
  assert.equal(hostJobCancellable(preview, "job-7"), false);
  assert.equal(hostJobCancellable({ ...running, status: "completed" }, "job-9"), false);

  const log = new HostJobLog();
  const first = log.begin({
    kind: "query",
    filePath: "/data/users.csv",
    fileName: "users.csv",
    dql: "where true",
  });
  const second = log.begin({
    kind: "query",
    filePath: "/data/users.csv",
    fileName: "users.csv",
    dql: "where false",
  });
  assert.equal(log.cancel(first.id), false);
  assert.equal(log.cancel(second.id), true);
  assert.equal(log.list().find((row) => row.id === second.id)?.status, "cancelled");
  log.finish(second.id, { outcome: "complete", elapsedMs: 10 });
  assert.equal(log.list().find((row) => row.id === second.id)?.status, "cancelled");
});

test("a completed query opens Result, a preview opens Data, and a cancelled row opens nothing", () => {
  assert.equal(hostJobOpen(job({ id: "a", kind: "query", status: "completed" })), "result");
  assert.equal(hostJobOpen(job({ id: "b", kind: "preview", status: "completed" })), "data");
  assert.equal(hostJobOpen(job({ id: "c", kind: "query", status: "cancelled" })), "none");
  assert.equal(hostJobOpen(job({ id: "d", kind: "query", status: "running" })), "none");
  assert.equal(hostJobOpen(job({ id: "e", kind: "query", status: "failed" })), "none");
  assert.equal(hostJobTerminal("complete", false), "completed");
  assert.equal(hostJobTerminal("failed", false), "failed");
  assert.equal(hostJobTerminal("cut-short", false), "failed");
  assert.equal(hostJobTerminal("complete", true), "cancelled");
});
