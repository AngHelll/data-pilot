import assert from "node:assert/strict";
import test from "node:test";
import { datasetColorToken } from "./dataset-color.js";

test("two datasets keep distinct stable colors", () => {
  const tiny = datasetColorToken("fixtures/sample/tiny.csv");
  const people = datasetColorToken("fixtures/sample/people.jsonl");
  assert.equal(datasetColorToken("fixtures/sample/tiny.csv"), tiny);
  assert.equal(datasetColorToken("fixtures/sample/people.jsonl"), people);
  assert.notEqual(tiny, people);
});
