import assert from "node:assert/strict";
import test from "node:test";
import { createWebviewNonce, isCspNonce } from "./nonce.js";

test("webview nonce stays inside the CSP base64 alphabet", () => {
  for (let i = 0; i < 20; i++) {
    const nonce = createWebviewNonce();
    assert.equal(isCspNonce(nonce), true);
    assert.equal(nonce.includes("."), false);
  }
});

test("a Math.random suffix is not a CSP nonce", () => {
  assert.equal(isCspNonce(`1728${String(0.42)}`), false);
});
