import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_EDITOR_QUERY_BUDGET,
  DEFAULT_EXPORT_BUDGET,
  DEFAULT_PREVIEW_BUDGET,
  PROTOCOL_VERSION,
  isStaleResponse,
  isUntrustedAllowed,
  type IpcResponse,
} from "./index.js";

describe("contracts", () => {
  it("exposes protocol version 1", () => {
    assert.equal(PROTOCOL_VERSION, 1);
  });

  it("detects stale IPC responses", () => {
    const response: IpcResponse = {
      protocolVersion: 1,
      requestId: "b",
      ok: true,
      result: null,
    };
    assert.equal(isStaleResponse("a", response), true);
    assert.equal(isStaleResponse("b", response), false);
  });

  it("names preview, editor Run, and export as three row ceilings", () => {
    assert.equal(DEFAULT_PREVIEW_BUDGET.maxRows, 200);
    assert.equal(DEFAULT_PREVIEW_BUDGET.maxBytes, 1024 * 1024);
    assert.equal(DEFAULT_EDITOR_QUERY_BUDGET.maxRows, 500);
    assert.equal(DEFAULT_EXPORT_BUDGET.maxRows, 10_000);
    assert.equal(DEFAULT_EXPORT_BUDGET.maxBytes, 10 * 1024 * 1024);
    assert.notEqual(DEFAULT_PREVIEW_BUDGET.maxRows, DEFAULT_EDITOR_QUERY_BUDGET.maxRows);
    assert.notEqual(DEFAULT_EDITOR_QUERY_BUDGET.maxRows, DEFAULT_EXPORT_BUDGET.maxRows);
  });

  it("allows only limited ops under untrusted", () => {
    assert.equal(isUntrustedAllowed("preview"), true);
    assert.equal(isUntrustedAllowed("exportResult"), false);
    assert.equal(isUntrustedAllowed("executeQuery"), false);
  });
});
