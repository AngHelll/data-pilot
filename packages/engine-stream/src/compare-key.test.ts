import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { DatasetStore } from "./session.js";
import { compareByKey } from "./compare-key.js";

async function withFiles(
  files: Record<string, string>,
  run: (store: DatasetStore, ids: Record<string, string>) => Promise<void>,
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "key-diff-"));
  const store = new DatasetStore();
  const ids: Record<string, string> = {};
  for (const [name, body] of Object.entries(files)) {
    const file = path.join(dir, name);
    await fs.writeFile(file, body, "utf8");
    const opened = await store.open(file);
    ids[name] = opened.handle.datasetId;
  }
  try {
    await run(store, ids);
  } finally {
    store.closeAll();
  }
}

describe("compare by key", () => {
  it("passes with empty lists when both sides match", async () => {
    const csv = "id,balance\na,1\nb,2\n";
    await withFiles({ "left.csv": csv, "right.csv": csv }, async (store, ids) => {
      const result = await compareByKey(store, ids["left.csv"]!, ids["right.csv"]!, "id");
      assert.equal(result.completion, "complete");
      assert.deepEqual(result.onlyLeft, []);
      assert.deepEqual(result.onlyRight, []);
      assert.deepEqual(result.changed, []);
      assert.equal(result.diagnostics.length, 0);
    });
  });

  it("classifies only-left, only-right, and a changed pair", async () => {
    await withFiles(
      {
        "left.csv": "id,balance\na,1\nb,2\nonlyL,9\n",
        "right.csv": "id,balance\nb,3\nc,4\na,1\n",
      },
      async (store, ids) => {
        const result = await compareByKey(store, ids["left.csv"]!, ids["right.csv"]!, "id");
        assert.equal(result.completion, "complete");
        assert.deepEqual(
          result.onlyLeft.map((v) => (v.kind === "string" ? v.value : "")),
          ["onlyL"],
        );
        assert.deepEqual(
          result.onlyRight.map((v) => (v.kind === "string" ? v.value : "")),
          ["c"],
        );
        assert.equal(result.changed.length, 1);
        assert.equal(result.changed[0]?.key.kind === "string" && result.changed[0].key.value, "b");
        assert.deepEqual(result.changed[0]?.columns, ["balance"]);
      },
    );
  });

  it("pairs the same keys when the row order differs", async () => {
    await withFiles(
      {
        "left.csv": "id,balance\na,1\nb,2\n",
        "right.csv": "id,balance\nb,2\na,1\n",
      },
      async (store, ids) => {
        const result = await compareByKey(store, ids["left.csv"]!, ids["right.csv"]!, "id");
        assert.equal(result.completion, "complete");
        assert.equal(result.changed.length, 0);
        assert.equal(result.onlyLeft.length, 0);
        assert.equal(result.onlyRight.length, 0);
      },
    );
  });

  it("counts a column that exists on only one side as a change", async () => {
    await withFiles(
      {
        "left.csv": "id,balance\na,1\n",
        "right.csv": "id,balance,note\na,1,x\n",
      },
      async (store, ids) => {
        const result = await compareByKey(store, ids["left.csv"]!, ids["right.csv"]!, "id");
        assert.deepEqual(result.changed[0]?.columns, ["note"]);
      },
    );
  });

  it("fails a repeated concrete key without pairing", async () => {
    await withFiles(
      {
        "left.csv": "id,name\n1,a\n1,b\n",
        "right.csv": "id,name\n1,a\n",
      },
      async (store, ids) => {
        const result = await compareByKey(store, ids["left.csv"]!, ids["right.csv"]!, "id");
        assert.equal(result.completion, "error");
        assert.equal(result.onlyLeft.length, 0);
        assert.equal(result.onlyRight.length, 0);
        assert.equal(result.changed.length, 0);
        assert.ok(result.diagnostics.some((d) => d.code === "compare-failed"));
      },
    );
  });

  it("ignores repeated null keys and rejects repeated empty strings", async () => {
    await withFiles(
      {
        "nulls.csv": "key,name\n,ada\n,bob\n",
        "other-nulls.csv": "key,name\n,cam\n",
        "blanks.jsonl": '{"key":"","name":"a"}\n{"key":"","name":"b"}\n',
        "one-blank.jsonl": '{"key":"","name":"a"}\n',
      },
      async (store, ids) => {
        const nulls = await compareByKey(store, ids["nulls.csv"]!, ids["other-nulls.csv"]!, "key");
        assert.equal(nulls.completion, "complete");
        assert.equal(nulls.onlyLeft.length, 0);
        assert.equal(nulls.onlyRight.length, 0);
        assert.equal(nulls.diagnostics.filter((d) => d.code === "compare-failed").length, 0);

        const blanks = await compareByKey(
          store,
          ids["blanks.jsonl"]!,
          ids["one-blank.jsonl"]!,
          "key",
        );
        assert.equal(blanks.onlyLeft.length, 0);
        assert.ok(blanks.diagnostics.some((d) => d.code === "compare-failed"));
      },
    );
  });

  it("does not return a prefix diff when the scan is cut short", async () => {
    await withFiles(
      {
        "left.csv": "id,balance\na,1\nb,2\n",
        "right.csv": "id,balance\na,9\nb,2\n",
      },
      async (store, ids) => {
        const result = await compareByKey(store, ids["left.csv"]!, ids["right.csv"]!, "id", {
          maxScanBytes: 1,
        });
        assert.equal(result.onlyLeft.length, 0);
        assert.equal(result.onlyRight.length, 0);
        assert.equal(result.changed.length, 0);
        assert.ok(
          result.diagnostics.some(
            (d) => d.code === "compare-failed" && d.message.includes("not exact"),
          ),
        );
      },
    );
  });

  it("reports an unknown key column", async () => {
    await withFiles({ "left.csv": "id,balance\na,1\n", "right.csv": "id,balance\na,1\n" }, async (store, ids) => {
      const result = await compareByKey(store, ids["left.csv"]!, ids["right.csv"]!, "nope");
      assert.ok(result.diagnostics.some((d) => d.code === "unknown-column"));
      assert.equal(result.diagnostics.some((d) => d.code === "compare-failed"), false);
    });
  });
});
