import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sourceStillMatches } from "./source-snapshot.js";

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

test("sourceStillMatches accepts the file that was read", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dp-snapshot-"));
  const file = path.join(dir, "tiny.csv");
  const text = "id,country\n1,MX\n";
  await fs.writeFile(file, text, "utf8");
  const size = (await fs.stat(file)).size;
  try {
    assert.equal(
      await sourceStillMatches(file, { sourceByteLength: size, sourceSha256: sha(text) }),
      true,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("sourceStillMatches rejects a same-size change and a missing fingerprint", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dp-snapshot-"));
  const file = path.join(dir, "tiny.csv");
  const text = "id,country\n1,MX\n";
  await fs.writeFile(file, text, "utf8");
  const size = (await fs.stat(file)).size;
  const changed = "id,country\n1,CA\n";
  await fs.writeFile(file, changed, "utf8");
  try {
    assert.equal((await fs.stat(file)).size, size);
    assert.equal(
      await sourceStillMatches(file, { sourceByteLength: size, sourceSha256: sha(text) }),
      false,
    );
    assert.equal(await fs.readFile(file, "utf8"), changed);
    assert.equal(await sourceStillMatches(file, {}), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
