import assert from "node:assert/strict";
import test from "node:test";
import type { SavedQuery } from "@data-pilot/contracts";
import {
  associateSavedQuery,
  nextSavedQueries,
  rememberDatasetPath,
  renameSavedQuery,
  savedQueryLink,
  savedQueryNeedsName,
  savedQueryPresentation,
  withoutAllSavedQueries,
  withoutSavedQuery,
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

test("a named query shows the name and a repeat save keeps it", () => {
  const named = { ...query('where country = "MX"', "/data/tiny.csv"), name: "Active MX users" };
  assert.equal(savedQueryPresentation(named).label, "Active MX users");
  const again = {
    ...query('where country = "MX"', "/data/tiny.csv"),
    savedAtMs: 8,
    schemaColumnNames: ["country", "id"],
  };
  const next = nextSavedQueries([named], again);
  assert.equal(next.length, 1);
  assert.equal(next[0]?.name, "Active MX users");
  assert.equal(next[0]?.savedAtMs, 8);
  assert.equal(savedQueryNeedsName([named], again), false);
  assert.equal(savedQueryNeedsName([], again), true);
});

test("rename changes the name and leaves the save time", () => {
  const row = { ...query('where country = "MX"', "/data/tiny.csv"), name: "Old" };
  const renamed = renameSavedQuery([row], row, "Active MX users");
  assert.equal(renamed[0]?.name, "Active MX users");
  assert.equal(renamed[0]?.savedAtMs, row.savedAtMs);
  const cleared = renameSavedQuery(renamed, renamed[0]!, "  ");
  assert.equal(cleared[0]?.name, undefined);
  assert.equal(savedQueryPresentation(cleared[0]!).label, 'where country = "MX"');
});

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

test("the same text and dataset replace earlier rows", () => {
  const older = query('where country = "MX"', "/data/tiny.csv");
  const duplicate = { ...older, savedAtMs: 2 };
  const newer = { ...older, savedAtMs: 3, schemaColumnNames: ["country", "id"] };
  const next = nextSavedQueries([duplicate, older], newer);
  assert.equal(next.length, 1);
  assert.equal(next[0]?.savedAtMs, 3);
  assert.deepEqual(next[0]?.schemaColumnNames, ["country", "id"]);
});

test("the same text on another dataset stays a second row", () => {
  const tiny = query('where country = "MX"', "/data/tiny.csv");
  const other = query('where country = "MX"', "/data/other.csv");
  const next = nextSavedQueries([tiny], other);
  assert.equal(next.length, 2);
});

test("saving with a path does not fill an older row that lacks one", () => {
  const older = query('where country = "MX"');
  const newer = query('where country = "MX"', "/data/tiny.csv");
  const next = nextSavedQueries([older], newer);
  assert.equal(next.length, 2);
  assert.equal(next[1]?.datasetPath, undefined);
});

test("associating one row leaves a different query without a path", () => {
  const other = query("where id = 1");
  const loose = query('where country = "MX"');
  const next = associateSavedQuery([other, loose], loose, "/data/tiny.csv");
  assert.equal(next.find((row) => row.dql === "where id = 1")?.datasetPath, undefined);
  assert.equal(next.find((row) => row.dql === 'where country = "MX"')?.datasetPath, "/data/tiny.csv");
});

test("delete removes one row and leaves the other", () => {
  const keep = query("where id = 1", "/data/tiny.csv");
  const drop = { ...query('where country = "MX"', "/data/tiny.csv"), savedAtMs: 4 };
  const twin = { ...drop, savedAtMs: 9 };
  const next = withoutSavedQuery([keep, drop, twin], drop);
  assert.deepEqual(next, [keep, twin]);
});

test("delete all leaves the list empty", () => {
  assert.deepEqual(withoutAllSavedQueries(), []);
});

test("associating a row writes its path and collapses an existing pair", () => {
  const loose = query('where country = "MX"');
  const already = query('where country = "MX"', "/data/tiny.csv");
  const next = associateSavedQuery([already, loose], loose, "/data/tiny.csv");
  assert.equal(next.length, 1);
  assert.equal(next[0]?.datasetPath, "/data/tiny.csv");
  assert.equal(next[0]?.savedAtMs, loose.savedAtMs);
});
