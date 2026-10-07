import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyCellEdit, previewCellEdit } from "./fixture-edit.js";

const tinyHeader = ["id", "name", "country"];

test("fixture edit previews and applies CSV cell change", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dp-edit-"));
  const file = path.join(dir, "tiny.csv");
  await fs.writeFile(
    file,
    "id,name,country\n1,Ada,MX\n2,Bob,US\n",
    "utf8",
  );
  const target = {
    filePath: file,
    format: "csv" as const,
    rowIndex: 0,
    column: "country",
    header: tinyHeader,
  };
  const before = await fs.readFile(file, "utf8");
  const preview = await previewCellEdit(target, "CA");
  assert.match(preview.unifiedDiff, /\+ .*CA/);
  assert.equal(preview.oldRaw, "MX");
  assert.equal(await fs.readFile(file, "utf8"), before);
  const planned = await applyCellEdit(target, "CA");
  assert.match(planned.afterText, /Ada,CA/);
  assert.equal(await fs.readFile(file, "utf8"), before);
  const same = await previewCellEdit(target, "MX");
  assert.equal(same.unifiedDiff, "");
  assert.equal(same.oldRaw, same.newRaw);
  await fs.rm(dir, { recursive: true });
});

test("fixture edit rejects an oversized file and leaves it untouched", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dp-edit-"));
  const file = path.join(dir, "tiny.csv");
  const body = "id,name,country\n1,Ada,MX\n";
  await fs.writeFile(file, body, "utf8");
  const target = {
    filePath: file,
    format: "csv" as const,
    rowIndex: 0,
    column: "country",
    header: tinyHeader,
  };
  await assert.rejects(
    () => previewCellEdit(target, "CA", 8),
    (err: { code?: string }) => err.code === "edit-too-large",
  );
  await assert.rejects(
    () => applyCellEdit(target, "CA", 8),
    (err: { code?: string }) => err.code === "edit-too-large",
  );
  assert.equal(await fs.readFile(file, "utf8"), body);
  await fs.rm(dir, { recursive: true });
});
