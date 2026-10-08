import assert from "node:assert/strict";
import test from "node:test";
import type { SavedQuery } from "@data-pilot/contracts";
import {
  nextSavedQueries,
  rememberDatasetPath,
  savedQueryLink,
  savedQueryPresentation,
} from "./saved-query-tree.js";

function query(dql: string, datasetPath?: string): SavedQuery {
  return {
    dqlVersion: "0.1",
    dql,
    schemaColumnNames: ["country"],
    savedAtMs: 1,
    ...(datasetPath ? { datasetPath } : {}),
  };
}

test("a saved query with a path names that file", () => {
  const shown = savedQueryPresentation(query('where country = "MX"', "/data/tiny.csv"));
  assert.equal(shown.description, "tiny.csv");
  assert.equal(shown.label, 'where country = "MX"');
  assert.match(shown.tooltip, /\/data\/tiny\.csv/);
  assert.equal(savedQueryLink(query('where country = "MX"', "/data/tiny.csv"))?.datasetPath, "/data/tiny.csv");
});

test("a saved query without a path does not use another session", () => {
  const shown = savedQueryPresentation(query('where country = "MX"'));
  assert.equal(shown.description, "No dataset");
  assert.equal(savedQueryLink(query('where country = "MX"')), undefined);
  assert.equal(rememberDatasetPath(query('where country = "MX"'), undefined).datasetPath, undefined);
});

test("append keeps datasetPath and an older entry without it", () => {
  const older = query("where id = 1");
  const newer = rememberDatasetPath(query('where country = "MX"', "/data/tiny.csv"), "/data/tiny.csv");
  const next = nextSavedQueries([older], newer);
  assert.equal(next[0]?.datasetPath, "/data/tiny.csv");
  assert.equal(next[1]?.datasetPath, undefined);
  assert.equal(next.length, 2);
});
