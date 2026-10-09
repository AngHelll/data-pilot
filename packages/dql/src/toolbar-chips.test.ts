import assert from "node:assert/strict";
import test from "node:test";
import { dropToolbarChip, readToolbarChips } from "./toolbar-chips.js";

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
