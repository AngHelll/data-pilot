import assert from "node:assert/strict";
import test from "node:test";
import {
  datasetFormatIcon,
  datasetOpenPlan,
  datasetRowColor,
  datasetRowState,
  type DatasetOpenTab,
} from "./dataset-open-plan.js";

function tab(partial: Partial<DatasetOpenTab> & Pick<DatasetOpenTab, "kind">): DatasetOpenTab {
  return {
    matchesFile: true,
    active: false,
    groupIndex: 0,
    tabIndex: 0,
    ...partial,
  };
}

test("an open Data Pilot tab is focused", () => {
  const plan = datasetOpenPlan([
    tab({ kind: "text", groupIndex: 0, tabIndex: 0, active: true }),
    tab({ kind: "data-pilot", groupIndex: 1, tabIndex: 2 }),
  ]);
  assert.deepEqual(plan, { action: "focus", groupIndex: 1, tabIndex: 2 });
});

test("text tabs are replaced in the active group", () => {
  const plan = datasetOpenPlan([
    tab({ kind: "text", groupIndex: 0, tabIndex: 1 }),
    tab({ kind: "text", groupIndex: 2, tabIndex: 0, active: true }),
    tab({ kind: "other", matchesFile: false, groupIndex: 2, tabIndex: 1 }),
  ]);
  assert.deepEqual(plan, {
    action: "replace-text",
    close: [
      { groupIndex: 0, tabIndex: 1 },
      { groupIndex: 2, tabIndex: 0 },
    ],
    groupIndex: 2,
  });
});

test("no tab opens a new Data Pilot editor", () => {
  assert.deepEqual(datasetOpenPlan([tab({ kind: "text", matchesFile: false })]), {
    action: "open-new",
  });
});

test("info does not change the open color", () => {
  assert.equal(datasetRowState({ open: false, diagnostics: [{ severity: "error" }] }), "idle");
  assert.equal(datasetRowState({ open: true, diagnostics: [{ severity: "info" }] }), "open");
  assert.equal(datasetRowState({ open: true, diagnostics: [{ severity: "hint" }] }), "open");
  assert.equal(datasetRowState({ open: true, diagnostics: [{ severity: "warning" }] }), "warning");
  assert.equal(datasetRowColor("idle"), undefined);
  assert.equal(datasetRowColor("open"), "charts.green");
  assert.equal(datasetRowColor("warning"), "charts.orange");
  assert.equal(datasetFormatIcon("/data/tiny.csv"), "table");
  assert.equal(datasetFormatIcon("/data/people.JSONL"), "json");
  assert.equal(datasetFormatIcon("/data/people.ndjson"), "json");
});
