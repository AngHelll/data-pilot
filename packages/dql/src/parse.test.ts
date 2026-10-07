import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeDql, formatDql, parseDql, ParseError } from "./index.js";

describe("DQL 0.1 parse", () => {
  it("parses where + take", () => {
    const q = parseDql('where country = "MX" and balance > 50000 | take 50');
    assert.equal(q.stages.length, 2);
    assert.equal(q.stages[0]?.kind, "where");
    assert.equal(q.stages[1]?.kind, "take");
  });

  it("parses is not null canonically", () => {
    const q = parseDql("where status is not null | select id");
    const where = q.stages[0];
    assert.equal(where?.kind, "where");
    if (where?.kind === "where") {
      assert.equal(where.predicate.kind, "is");
      if (where.predicate.kind === "is") {
        assert.equal(where.predicate.test, "null");
        assert.equal(where.predicate.negated, true);
      }
    }
    assert.equal(formatDql(q), "where status is not null | select id");
  });

  it("parses find with case mode and escaped ident", () => {
    const q = parseDql('find "acme" in name, `order id` case sensitive | take 1');
    assert.equal(q.stages[0]?.kind, "find");
    if (q.stages[0]?.kind === "find") {
      assert.deepEqual(q.stages[0].columns, ["name", "order id"]);
      assert.equal(q.stages[0].caseMode, "sensitive");
    }
  });

  it("parses infix in lists", () => {
    const q = parseDql('where currency in ["MXN", "USD"] | count');
    assert.equal(q.stages[1]?.kind, "count");
  });

  it("parses expect count and formats canonical spacing", () => {
    const q = parseDql('where country = "MX"|expect count = 2');
    assert.equal(q.version, "0.1");
    assert.equal(q.stages[1]?.kind, "expectCount");
    if (q.stages[1]?.kind === "expectCount") assert.equal(q.stages[1].count, 2);
    assert.equal(formatDql(q), 'where country = "MX" | expect count = 2');
  });

  it("rejects other expect forms, a count before expect, and a negative N", () => {
    assert.throws(
      () => parseDql("expect nope"),
      (err: unknown) => err instanceof ParseError && err.code === "unsupported-operation",
    );
    assert.throws(
      () => parseDql("when balance > 1"),
      (err: unknown) => err instanceof ParseError && err.code === "unsupported-operation",
    );
    assert.throws(
      () => parseDql("count | expect count = 2"),
      (err: unknown) => err instanceof ParseError && err.code === "invalid-pipeline",
    );
    assert.throws(
      () => parseDql("expect count = -1"),
      (err: unknown) => err instanceof ParseError && err.code === "parse-error",
    );
  });

  it("parses expect unique and formats it", () => {
    const q = parseDql("expect unique country");
    assert.equal(q.version, "0.1");
    assert.equal(q.stages[0]?.kind, "expectUnique");
    if (q.stages[0]?.kind === "expectUnique") assert.equal(q.stages[0].column, "country");
    assert.equal(formatDql(q), "expect unique country");
  });

  it("rejects count before expect unique and an unknown unique column", () => {
    assert.throws(
      () => parseDql("count | expect unique id"),
      (err: unknown) => err instanceof ParseError && err.code === "invalid-pipeline",
    );
    const result = analyzeDql("expect unique nope", [
      { name: "id", inferredType: "string" },
    ]);
    assert.ok(result.diagnostics.some((d) => d.code === "unknown-column"));
  });

  it("rejects sort as unsupported", () => {
    assert.throws(
      () => parseDql("sort by balance"),
      (err: unknown) => err instanceof ParseError && err.code === "unsupported-operation",
    );
  });

  it("rejects invalid pipeline take then where", () => {
    assert.throws(
      () => parseDql('take 10 | where x > 1'),
      (err: unknown) => err instanceof ParseError && err.code === "invalid-pipeline",
    );
  });

  it("typechecks unknown column", () => {
    const result = analyzeDql('where nope = "x"', [
      { name: "country", inferredType: "string" },
    ]);
    assert.ok(result.diagnostics.some((d) => d.code === "unknown-column"));
  });

  it("flags unbound params", () => {
    const result = analyzeDql("where country = $country", [
      { name: "country", inferredType: "string" },
    ]);
    assert.ok(result.diagnostics.some((d) => d.code === "unbound-parameter"));
  });
});
