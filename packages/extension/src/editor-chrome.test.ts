import assert from "node:assert/strict";
import test from "node:test";
import {
  activityText,
  columnPresentation,
  gridFooter,
  resultTabLabel,
} from "./editor-chrome.js";

test("a named query titles the result tab", () => {
  assert.equal(resultTabLabel("Active MX users", 'where country = "MX"'), "Active MX users");
  assert.equal(
    resultTabLabel(undefined, 'where country = "MX" and status = "ACTIVE"'),
    "where country = \"MX\" and status…",
  );
  assert.equal(resultTabLabel("  ", undefined), "Result");
});

test("the footer names the grid, the ending, and the returned range", () => {
  const done = gridFooter({
    surface: "Result",
    rowCountReturned: 12,
    completion: "complete",
    elapsedMs: 84,
  });
  assert.match(done, /^Result · 12 rows returned · Complete · 84 ms\nShowing 1–12 of 12$/);
  const cut = gridFooter({
    surface: "Preview",
    rowCountReturned: 20,
    completion: "truncated",
  });
  assert.equal(cut, "Preview · 20 rows returned · Cut short\nShowing 1–20 of 20");
  assert.equal(cut.includes("2481"), false);
  const empty = gridFooter({
    surface: "Result",
    rowCountReturned: 0,
    completion: "cancelled",
  });
  assert.equal(empty, "Result · 0 rows returned · Cancelled");
});

test("status text omits milliseconds that were not measured", () => {
  assert.equal(activityText("query", "complete", 84), "Query complete · 84 ms");
  assert.equal(activityText("query", "failed"), "Query failed");
  assert.equal(activityText("preview", "cut-short", undefined), "Preview cut short");
});

test("pills are for booleans and short low-cardinality strings", () => {
  assert.deepEqual(columnPresentation({ inferredType: "boolean" }), { pill: true, align: "start" });
  assert.deepEqual(columnPresentation({ inferredType: "integer" }), { pill: false, align: "end" });
  assert.deepEqual(columnPresentation({ inferredType: "decimal" }), { pill: false, align: "end" });
  assert.deepEqual(
    columnPresentation({
      inferredType: "string",
      distinctCountSample: 2,
      seenValues: ["ACTIVE", "INACTIVE"],
    }),
    { pill: true, align: "start" },
  );
  assert.deepEqual(
    columnPresentation({
      inferredType: "string",
      distinctCountSample: 7,
      seenValues: ["a", "b", "c", "d", "e", "f", "g"],
    }),
    { pill: false, align: "start" },
  );
  assert.equal(
    columnPresentation({
      inferredType: "string",
      distinctCountSample: 1,
      seenValues: ["this value is definitely over sixteen"],
    }).pill,
    false,
  );
});
