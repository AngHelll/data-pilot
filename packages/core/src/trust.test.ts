import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UNTRUSTED_ALLOWED_OPS, UNTRUSTED_BLOCKED_OPS } from "@data-pilot/contracts";
import { assertOpAllowed } from "./index.js";

describe("trust gate", () => {
  it("allows preview in untrusted-limited", () => {
    assert.equal(
      assertOpAllowed({ trustMode: "untrusted-limited" }, "preview"),
      null,
    );
  });

  it("blocks export and edit in untrusted-limited", () => {
    assert.equal(
      assertOpAllowed({ trustMode: "untrusted-limited" }, "exportResult")?.code,
      "untrusted-blocked",
    );
    assert.equal(
      assertOpAllowed({ trustMode: "untrusted-limited" }, "editFixture")?.code,
      "untrusted-blocked",
    );
  });

  it("blocks compareDatasets in untrusted-limited", () => {
    assert.ok(UNTRUSTED_BLOCKED_OPS.includes("compareDatasets"));
    assert.equal(
      (UNTRUSTED_ALLOWED_OPS as readonly string[]).includes("compareDatasets"),
      false,
    );
    assert.equal(
      assertOpAllowed({ trustMode: "untrusted-limited" }, "compareDatasets")?.code,
      "untrusted-blocked",
    );
    assert.equal(assertOpAllowed({ trustMode: "trusted" }, "compareDatasets"), null);
  });

  it("allows export when trusted", () => {
    assert.equal(
      assertOpAllowed({ trustMode: "trusted" }, "exportResult"),
      null,
    );
  });
});
