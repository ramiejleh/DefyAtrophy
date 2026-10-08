import assert from "node:assert/strict";
import { test } from "node:test";
import { diffLines } from "../lib/diff.js";
import { applyHoles, parseHoles, parseNotes, segmentsFor } from "../lib/build.js";
import { rebuild, rows, splitContent } from "../lib/session.js";

const fileFrom = (oldC, newC) => {
  const split = splitContent(newC ?? "");
  return { path: "f", eol: split.eol, finalNewline: newC ? split.finalNewline : false, segments: segmentsFor(oldC, newC) };
};

test("diff reproduces the new lines from equal + insert ops", () => {
  const a = ["a", "b", "c", "d", "e"];
  const b = ["a", "x", "c", "d", "y", "e", "z"];
  const ops = diffLines(a, b);
  assert.deepEqual(ops.filter((o) => o.op !== "delete").map((o) => b[o.b]), b);
  assert.deepEqual(ops.filter((o) => o.op !== "insert").map((o) => a[o.a]), a);
  assert.equal(ops.filter((o) => o.op === "equal").length, 4);
});

test("diff puts deletes before inserts in a replaced block", () => {
  const ops = diffLines(["keep", "old1", "old2", "keep2"], ["keep", "new1", "keep2"]);
  assert.deepEqual(ops.map((o) => o.op), ["equal", "delete", "delete", "insert", "equal"]);
});

test("diff handles empty sides and random inputs", () => {
  assert.deepEqual(diffLines([], ["a"]).map((o) => o.op), ["insert"]);
  assert.deepEqual(diffLines(["a"], []).map((o) => o.op), ["delete"]);
  for (let n = 0; n < 200; n++) {
    const rand = () => Array.from({ length: Math.floor(Math.random() * 12) }, () => "abc"[Math.floor(Math.random() * 3)]);
    const a = rand();
    const b = rand();
    const ops = diffLines(a, b);
    assert.deepEqual(ops.filter((o) => o.op !== "delete").map((o) => b[o.b]), b);
    assert.deepEqual(ops.filter((o) => o.op !== "insert").map((o) => a[o.a]), a);
  }
});

const CASES = {
  lf: ["a\nb\nc\n", "a\nB\nc\nd\n"],
  crlf: ["one\r\ntwo\r\n", "one\r\n  two\r\nthree\r\n"],
  tabs: ["func main() {\n\tfmt.Println(1)\n}\n", "func main() {\n\tif x {\n\t\tfmt.Println(2)\n\t}\n}\n"],
  noFinalNewline: ["x = 1", "x = 1\ny = 2"],
  trailingSpaces: ["a  \nb\n", "a  \n b \t\nc\n"],
  blankLines: ["a\n\n\nb\n", "a\n\n  \nb\n\nc\n"],
  create: [null, "new\n\tfile\n"],
  empty: ["x\n", ""],
};

for (const [name, [oldC, newC]] of Object.entries(CASES)) {
  test(`rebuild round-trips: ${name}`, () => {
    assert.equal(rebuild(fileFrom(oldC, newC)), newC);
  });
}

test("rows number new and old lines", () => {
  const f = fileFrom("a\nb\nc\n", "a\nX\nc\n");
  assert.deepEqual(rows(f).map((r) => [r.kind, r.newNo ?? null, r.oldNo ?? null]), [
    ["given", 1, null],
    ["removed", null, 2],
    ["typed", 2, null],
    ["given", 3, null],
  ]);
});

test("parseNotes reads positive and negative keys", () => {
  const notes = parseNotes("# comment\nsrc/a:b.ts:3\tthird line\nsrc/x.ts:-2\tremoved it\\nbecause\nbad line\n");
  assert.equal(notes.get("src/a:b.ts:3"), "third line");
  assert.equal(notes.get("src/x.ts:-2"), "removed it\nbecause");
  assert.equal(notes.size, 2);
});

test("holes rebuild to the reference and keep removed lines", () => {
  const oldC = "function f() {\n  return 1;\n}\n";
  const newC = "function f() {\n  const x = 2;\n  return x;\n}\n";
  const file = fileFrom(oldC, newC);
  const [hole] = parseHoles("## f:2-3 body\nCompute and return x.\n");
  const reference = {};
  file.segments = applyHoles(file, [hole], reference);
  assert.deepEqual(file.segments.map((s) => s.kind), ["given", "removed", "hole", "given"]);
  assert.equal(rebuild(file, (id) => reference[id]), newC);
  assert.equal(file.segments[2].spec, "Compute and return x.");
  assert.throws(() => applyHoles(fileFrom(oldC, newC), [{ id: "a", start: 1, end: 2 }, { id: "b", start: 2, end: 3 }], {}), /overlap/);
});
