import assert from "node:assert/strict";
import test from "node:test";
import { filterToDql } from "./filter-dql.js";

test("filterToDql writes where, find, and both", () => {
  assert.equal(
    filterToDql({ column: "country", op: "=", value: "MX", columns: ["country"] }),
    'where country = "MX"',
  );
  assert.equal(
    filterToDql({ column: "balance", op: ">", value: "50000", columns: ["balance"] }),
    "where balance > 50000",
  );
  assert.equal(
    filterToDql({ column: "name", op: "is not null", value: "", columns: ["name"] }),
    "where name is not null",
  );
  assert.equal(
    filterToDql({ search: "ada", columns: ["name", "country"] }),
    'find "ada" in name, country',
  );
  assert.equal(
    filterToDql({
      column: "country",
      op: "=",
      value: "MX",
      search: "ada",
      columns: ["name"],
    }),
    'find "ada" in name | where country = "MX"',
  );
});

test("filterToDql projects the visible columns without running", () => {
  assert.equal(filterToDql({ columns: ["id", "name"], project: true }), "select id, name");
  assert.equal(
    filterToDql({
      column: "country",
      op: "=",
      value: "MX",
      search: "ada",
      columns: ["name", "country"],
      project: true,
    }),
    'find "ada" in name, country | where country = "MX" | select name, country',
  );
  assert.equal(
    filterToDql({ columns: ["order id", "name"], project: true }),
    "select `order id`, name",
  );
  assert.equal(filterToDql({ columns: [], project: true }), null);
  assert.equal(filterToDql({ columns: ["id", "name"] }), null);
});

test("filterToDql joins comparisons with and and keeps find", () => {
  assert.equal(
    filterToDql({
      filters: [
        { column: "country", op: "=", value: "MX" },
        { column: "status", op: "=", value: "ACTIVE" },
      ],
      columns: ["country", "status"],
    }),
    'where country = "MX" and status = "ACTIVE"',
  );
  assert.equal(
    filterToDql({
      filters: [
        { column: "country", op: "=", value: "MX" },
        { column: "balance", op: ">", value: "50000" },
      ],
      search: "ada",
      columns: ["name"],
    }),
    'find "ada" in name | where country = "MX" and balance > 50000',
  );
  assert.equal(
    filterToDql({
      filters: [{ column: "name", op: "is not null" }],
      columns: ["name"],
    }),
    "where name is not null",
  );
  assert.equal(filterToDql({ filters: [], columns: ["name"] }), null);
  assert.equal(
    filterToDql({ filters: [{ column: "country", op: "like", value: "MX" }], columns: ["country"] }),
    null,
  );
});

test("filterToDql leaves an empty draft alone and quotes odd names", () => {
  assert.equal(filterToDql({ columns: ["name"] }), null);
  assert.equal(filterToDql({ search: "   ", columns: ["name"] }), null);
  assert.equal(
    filterToDql({ column: "order id", op: "=", value: "A", columns: ["order id"] }),
    'where `order id` = "A"',
  );
});
