import assert from "node:assert/strict";
import test from "node:test";
import { addToolbarFilter, addToolbarSearch, dropToolbarChip, readToolbarChips } from "./toolbar-chips.js";

const columns = ["id", "country", "balance", "name"];

test("readToolbarChips splits an and where and a matching find", () => {
  assert.deepEqual(
    readToolbarChips('where country = "MX" and balance > 50000 | select id, name | take 10', columns),
    {
      filters: [
        { column: "country", op: "=", value: "MX" },
        { column: "balance", op: ">", value: "50000" },
      ],
      search: null,
    },
  );
  assert.deepEqual(
    readToolbarChips('find "ada" in id, country, balance, name | where name is not null', columns),
    {
      filters: [{ column: "name", op: "is not null", value: "" }],
      search: "ada",
    },
  );
  assert.equal(readToolbarChips('where currency in ["MXN", "USD"]', columns).filters, null);
  assert.equal(readToolbarChips('where country = "MX" or country = "US"', columns).filters, null);
  assert.equal(readToolbarChips("where balance is missing", columns).filters, null);
  assert.equal(readToolbarChips("where balance is empty", columns).filters, null);
  assert.equal(readToolbarChips("where country = $code", columns).filters, null);
  assert.equal(readToolbarChips('where opened = date("2020-01-01")', columns).filters, null);
  assert.equal(readToolbarChips('where not country = "MX"', columns).filters, null);
  assert.equal(readToolbarChips('where contains(name, "Ada")', columns).filters, null);
  assert.equal(
    readToolbarChips('find "ada" in name case sensitive | where country = "MX"', columns).search,
    null,
  );
  assert.equal(readToolbarChips('find "ada" in name | where country = "MX"', columns).search, null);
  assert.equal(readToolbarChips("take 10", columns).filters?.length, 0);
  assert.equal(readToolbarChips("where", columns).filters, null);
});

test("dropToolbarChip removes one comparison and keeps the other stages", () => {
  assert.equal(
    dropToolbarChip(
      'where country = "MX" and balance > 50000 | select id, name | take 10',
      columns,
      { filter: 0 },
    ),
    "where balance > 50000 | select id, name | take 10",
  );
  assert.equal(dropToolbarChip('where country = "MX" | count', columns, { filter: 0 }), "count");
  assert.equal(
    dropToolbarChip('where country = "MX" | expect count = 2', columns, { filter: 0 }),
    "expect count = 2",
  );
  assert.equal(
    dropToolbarChip('where active = true and country = "MX"', columns, { filter: 1 }),
    "where active = true",
  );
  assert.equal(dropToolbarChip('where currency in ["MXN", "USD"]', columns, { filter: 0 }), null);
  assert.equal(
    dropToolbarChip(
      'find "ada" in id, country, balance, name | where country = "MX" | take 10',
      columns,
      { search: true },
    ),
    'where country = "MX" | take 10',
  );
  assert.equal(
    dropToolbarChip('find "ada" in name case sensitive | where country = "MX"', columns, { search: true }),
    null,
  );
});

test("addToolbarFilter keeps select and take and refuses an or where", () => {
  assert.equal(
    addToolbarFilter('where country = "MX" | take 20', {
      column: "status",
      op: "=",
      value: "ACTIVE",
    }),
    'where country = "MX" and status = "ACTIVE" | take 20',
  );
  assert.equal(
    addToolbarFilter('select id, name | take 10', { column: "country", op: "=", value: "MX" }),
    'where country = "MX" | select id, name | take 10',
  );
  assert.equal(
    addToolbarFilter("", { column: "country", op: "=", value: "MX" }),
    'where country = "MX"',
  );
  assert.equal(
    addToolbarFilter("take 20", { column: "name", op: "is null", value: "" }),
    "where name is null | take 20",
  );
  assert.equal(
    addToolbarFilter('where country = "MX" or country = "US" | take 20', {
      column: "status",
      op: "=",
      value: "ACTIVE",
    }),
    null,
  );
  assert.equal(
    addToolbarFilter('where country = "MX" | take 20', { column: "status", op: "like", value: "A" }),
    null,
  );
});

test("addToolbarSearch keeps the where and refuses a find the toolbar cannot show", () => {
  assert.equal(
    addToolbarSearch('where country = "MX" | take 20', columns, "ada"),
    'find "ada" in id, country, balance, name case insensitive | where country = "MX" | take 20',
  );
  assert.equal(
    addToolbarSearch(
      'find "ada" in id, country, balance, name | where country = "MX" | take 10',
      columns,
      "bob",
    ),
    'find "bob" in id, country, balance, name case insensitive | where country = "MX" | take 10',
  );
  assert.equal(
    addToolbarSearch('find "ada" in name case sensitive | where country = "MX"', columns, "bob"),
    null,
  );
  assert.equal(addToolbarSearch('where country = "MX"', [], "ada"), null);
});
