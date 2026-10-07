import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChildProcessHost } from "./child-process-host.js";
import { resolveTsWorkerEntry } from "./paths.js";

describe("ChildProcessHost", () => {
  it("starts, pings, and stops", async () => {
    const host = new ChildProcessHost({ workerEntry: resolveTsWorkerEntry() });
    const { startupMs } = await host.start();
    assert.ok(startupMs > 0);
    const res = await host.request("ping", undefined, { timeoutMs: 3000 });
    assert.equal(res.ok, true);
    await host.stop();
  });

  it("blocks export under untrusted-limited", async () => {
    const host = new ChildProcessHost({
      workerEntry: resolveTsWorkerEntry(),
      trustMode: "untrusted-limited",
    });
    await host.start();
    const res = await host.request("exportResult", {}, { timeoutMs: 3000 });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.error.code, "untrusted-blocked");
    await host.stop();
  });
});
