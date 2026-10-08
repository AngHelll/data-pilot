import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseDatasetPath,
  chooseResultPlacement,
  resultTargetText,
  runOnChoices,
  runTargetActionText,
  runTargetText,
} from "./dql-link.js";

test("chooseResultPlacement reuses one surface and ignores another editor", () => {
  assert.equal(
    chooseResultPlacement({
      besidePanelOpen: true,
      datasetPath: "/data/tiny.csv",
      openEditorPaths: ["/data/tiny.csv"],
    }),
    "update-open-panel",
  );
  assert.equal(
    chooseResultPlacement({
      besidePanelOpen: false,
      datasetPath: "/data/tiny.csv",
      openEditorPaths: ["/data/tiny.csv"],
    }),
    "paint-open-editor",
  );
  assert.equal(
    chooseResultPlacement({
      besidePanelOpen: false,
      datasetPath: "/data/tiny.csv",
      openEditorPaths: [],
    }),
    "open-editor",
  );
  assert.equal(
    chooseResultPlacement({
      besidePanelOpen: false,
      datasetPath: "/data/tiny.csv",
      openEditorPaths: ["/data/other.csv"],
    }),
    "open-editor",
  );
});

test("chooseDatasetPath does not pick the first open session", () => {
  assert.equal(chooseDatasetPath(undefined, ["/data/a.csv", "/data/b.csv"]), undefined);
  assert.equal(chooseDatasetPath({ datasetPath: "", columns: [] }, ["/data/a.csv"]), undefined);
});

test("runTargetText names the linked file and the missing link", () => {
  assert.equal(runTargetText("/data/tiny.csv"), "Runs on tiny.csv");
  assert.equal(runTargetText(undefined), "No dataset — Run will ask which one");
  assert.equal(runTargetActionText("/data/tiny.csv"), "Runs on tiny.csv · click to change");
  assert.equal(runTargetActionText(undefined), "No dataset — click to choose");
});

test("resultTargetText keeps the shown rows apart from the query in front", () => {
  assert.equal(resultTargetText("/data/tiny.csv", "/data/tiny.csv"), "Rows from tiny.csv.");
  assert.equal(
    resultTargetText("/data/tiny.csv", "/data/people.jsonl"),
    "Rows from tiny.csv. The query in front runs on people.jsonl.",
  );
  assert.equal(
    resultTargetText("/data/tiny.csv", undefined),
    "Rows from tiny.csv. The query in front has no dataset. Run will ask which one.",
  );
});

test("runOnChoices puts the current link first and keeps the other open sessions", () => {
  assert.deepEqual(runOnChoices(["/data/tiny.csv", "/data/quoted.csv"], "/data/quoted.csv"), [
    { path: "/data/quoted.csv", current: true },
    { path: "/data/tiny.csv", current: false },
  ]);
  assert.deepEqual(runOnChoices(["/data/tiny.csv"], undefined), [
    { path: "/data/tiny.csv", current: false },
  ]);
});

test("chooseDatasetPath uses the linked path", () => {
  assert.equal(
    chooseDatasetPath(
      { datasetPath: "/data/b.csv", columns: [{ name: "country", inferredType: "string" }] },
      ["/data/a.csv"],
    ),
    "/data/b.csv",
  );
});
