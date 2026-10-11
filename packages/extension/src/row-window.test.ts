import assert from "node:assert/strict";
import test from "node:test";
import {
  ROW_HEIGHT_PX,
  queryCanPage,
  rememberPageOffset,
  visibleRowWindow,
} from "./row-window.js";

test("a page of 200 rows paints only the visible window", () => {
  const window = visibleRowWindow({
    rowCount: 200,
    scrollTop: 0,
    viewportHeight: ROW_HEIGHT_PX * 10,
  });
  assert.equal(window.start, 0);
  assert.ok(window.end < 40);
  assert.ok(window.end < 200);
  assert.equal(window.topPx, 0);
  assert.equal(window.bottomPx, (200 - window.end) * ROW_HEIGHT_PX);
});

test("scrolling reveals a later slice and keeps the spacers", () => {
  const window = visibleRowWindow({
    rowCount: 200,
    scrollTop: ROW_HEIGHT_PX * 50,
    viewportHeight: ROW_HEIGHT_PX * 10,
  });
  assert.ok(window.start > 30);
  assert.ok(window.start < 50);
  assert.ok(window.end > 60);
  assert.ok(window.end < 80);
  assert.equal(window.topPx + (window.end - window.start) * ROW_HEIGHT_PX + window.bottomPx, 200 * ROW_HEIGHT_PX);
});

test("a closed count or take does not page, and the offset stack steps back", () => {
  assert.equal(queryCanPage(["where"], "truncated"), true);
  assert.equal(queryCanPage(["where", "take"], "truncated"), false);
  assert.equal(queryCanPage(["count"], "complete"), false);
  assert.deepEqual(rememberPageOffset([0], 200), [0, 200]);
  assert.deepEqual(rememberPageOffset([0, 200], 0), [0]);
});
