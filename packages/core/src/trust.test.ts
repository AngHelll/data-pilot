import assert from "node:assert/strict";
import { describe, it } from "node:test";
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

  it("allows export when trusted", () => {
    assert.equal(
      assertOpAllowed({ trustMode: "trusted" }, "exportResult"),
      null,
    );
  });
});
