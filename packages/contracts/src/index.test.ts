import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
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

  it("allows only limited ops under untrusted", () => {
    assert.equal(isUntrustedAllowed("preview"), true);
    assert.equal(isUntrustedAllowed("exportResult"), false);
    assert.equal(isUntrustedAllowed("executeQuery"), false);
  });
});
