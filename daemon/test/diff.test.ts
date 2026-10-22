import assert from "node:assert/strict";
import { test } from "node:test";
import { fromEdit, fromNew, fromToolInput, MAX_LINES, toUnified } from "../src/diff/diffEngine.js";

test("an edit counts added and removed lines and keeps context", () => {
  const d = fromEdit("a\nb\nc\nd\n", "a\nB\nc\nd\ne\n", "x.ts");
  assert.equal(d.added, 2);
  assert.equal(d.removed, 1);
  assert.equal(d.hunks.length, 1);
  assert.deepEqual(d.hunks[0].lines.map((l) => l.kind[0]).join(""), "crac" + "ca");
  assert.ok(toUnified({ ...d, id: 1, tool: "Edit", at: 0 }).includes("+B"));
});

test("far-apart changes make separate hunks", () => {
  const old = Array.from({ length: 40 }, (_, i) => `l${i}`).join("\n");
  const neu = old.replace("l2\n", "L2\n").replace("l35", "L35");
  const d = fromEdit(old, neu, "f");
  assert.equal(d.hunks.length, 2);
  assert.equal(d.added, 2);
  assert.equal(d.removed, 2);
});

test("a Write is all additions; a huge one is only counted", () => {
  assert.equal(fromNew("x\ny\n", "n").added, 2);
  const big = fromNew(Array.from({ length: MAX_LINES + 5 }, () => "z").join("\n"), "n");
  assert.equal(big.tooLarge, true);
  assert.equal(big.hunks.length, 0);
  assert.equal(big.added, MAX_LINES + 5);
});

test("MultiEdit merges its edits; other tools give nothing", () => {
  const d = fromToolInput("MultiEdit", { file_path: "/a/b.ts", edits: [{ old_string: "a", new_string: "b" }, { old_string: "", new_string: "c\nd" }] });
  assert.ok(d);
  assert.equal(d!.added, 3);
  assert.equal(d!.removed, 1);
  assert.equal(fromToolInput("Bash", { command: "ls" }), null);
});
