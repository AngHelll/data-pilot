import assert from "node:assert/strict";
import test from "node:test";
import { parseWebviewMessage } from "./messages.js";

test("parseWebviewMessage accepts handshake", () => {
  assert.deepEqual(parseWebviewMessage({ type: "webviewReady" }), { type: "webviewReady" });
});

test("parseWebviewMessage rejects unknown types", () => {
  assert.equal(parseWebviewMessage({ type: "nope" }), null);
});

test("parseWebviewMessage accepts query, save, export, and inspect", () => {
  assert.deepEqual(parseWebviewMessage({ type: "planDql", dql: ' where country = "MX" ' }), {
    type: "planDql",
    dql: 'where country = "MX"',
  });
  assert.deepEqual(parseWebviewMessage({ type: "runQuery", dql: "where balance > 50000" }), {
    type: "runQuery",
    dql: "where balance > 50000",
  });
  assert.deepEqual(parseWebviewMessage({ type: "saveQuery", dql: 'where country = "MX"' }), {
    type: "saveQuery",
    dql: 'where country = "MX"',
  });
  assert.deepEqual(
    parseWebviewMessage({ type: "exportQuery", dql: 'where country = "MX"', format: "csv" }),
    { type: "exportQuery", dql: 'where country = "MX"', format: "csv" },
  );
  assert.deepEqual(parseWebviewMessage({ type: "inspectCell", rowIndex: 0, column: "name" }), {
    type: "inspectCell",
    rowIndex: 0,
    column: "name",
  });
});

test("parseWebviewMessage rejects empty DQL and empty inspect column", () => {
  assert.equal(parseWebviewMessage({ type: "planDql", dql: "   " }), null);
  assert.equal(parseWebviewMessage({ type: "runQuery", dql: "" }), null);
  assert.equal(parseWebviewMessage({ type: "saveQuery", dql: "" }), null);
  assert.equal(parseWebviewMessage({ type: "exportQuery", dql: "" }), null);
  assert.equal(parseWebviewMessage({ type: "inspectCell", rowIndex: 0, column: "" }), null);
  assert.equal(parseWebviewMessage({ type: "exportQuery", dql: "where true", format: "parquet" }), null);
});
