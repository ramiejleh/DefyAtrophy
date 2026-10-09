import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { author, makeRepo, makeSolution, sh, writeFiles } from "./helpers.js";

const BIN = join(import.meta.dirname, "..", "cli", "line-by-line");
const run = (cwd, ...args) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
};

const FILES = {
  "app/main.py": "def main():\n    print('hi')\n",
  "go/tool.go": "package tool\n\nfunc Add(a, b int) int {\n\treturn a + b\n}\n",
  "win.cfg": "a=1\r\nb=2\r\n",
  "old.txt": "remove me\n",
  "logo.bin": Buffer.from([1, 0, 2, 0, 3]),
};
const CHANGES = {
  "app/main.py": "def main():\n    print('hi')\n    print(helper())\n",
  "app/helper.py": "def helper():\n    return 42\n",
  "go/tool.go": "package tool\n\nfunc Add(a, b int) int {\n\tif a == 0 {\n\t\treturn b\n\t}\n\treturn a + b\n}\n",
  "win.cfg": "a=1\r\nb=3\r\n",
  "old.txt": null,
  "logo.bin": Buffer.from([1, 0, 2, 0, 4]),
};

test("CLI: build → assemble → validate for a mixed-language type session", () => {
  const project = makeRepo(FILES);
  const solution = makeSolution(project, CHANGES);
  const built = run(project, "build", "--mode", "type", "--solution", solution, "--task", "Add a helper");
  assert.equal(built.code, 0, built.out);
  const dir = join(project, ".line-by-line", "add-a-helper");
  assert.match(built.out, /5 files to type/);
  assert.match(built.out, /1 applied automatically/);
  assert.ok(readFileSync(join(project, ".git", "info", "exclude"), "utf8").includes(".line-by-line/"), "session data is git-ignored without touching .gitignore");
  const todo = readFileSync(join(dir, "notes-todo.txt"), "utf8");
  assert.match(todo, /go\/tool\.go:4\t\tif a == 0 \{/, "tab indents survive in the todo list");

  const noNotes = run(project, "assemble", dir);
  assert.equal(noNotes.code, 1);
  assert.match(noNotes.out, /notes\.txt is missing/);

  author(dir);
  const ok = run(project, "assemble", dir);
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /VALID/);

  // the session must cover every changed file
  const steps = JSON.parse(readFileSync(join(dir, "steps.json"), "utf8"));
  steps.steps[0].files = steps.steps[0].files.filter((f) => f.path !== "app/helper.py");
  writeFileSync(join(dir, "steps.json"), JSON.stringify(steps));
  const missing = run(project, "assemble", dir);
  assert.equal(missing.code, 1);
  assert.match(missing.out, /app\/helper\.py changed but isn't in any step/);
});

test("CLI: review mode builds from git with --base, and list/status describe it", () => {
  const project = makeRepo(FILES);
  sh(project, "git", ["checkout", "-qb", "feature"]);
  writeFiles(project, CHANGES);
  sh(project, "git", ["add", "-A"]);
  sh(project, "git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "feature"]);
  const built = run(project, "build", "--mode", "review", "--base", "main", "--task", "review feature");
  assert.equal(built.code, 0, built.out);
  const dir = join(project, ".line-by-line", "review-feature");
  assert.match(readFileSync(join(dir, "notes-todo.txt"), "utf8"), /old\.txt:-1\tremove me/, "removed lines get negative keys");
  author(dir);
  assert.match(run(project, "assemble", dir).out, /VALID/);
  assert.match(run(project, "list").out, /review-feature\s+review/);
  assert.match(run(project, "status", dir).out, /Nothing waiting for Claude/);

  const same = makeRepo(FILES);
  const nothing = run(same, "build", "--mode", "review", "--base", "main");
  assert.equal(nothing.code, 1);
  assert.match(nothing.out, /no commits that aren't on main/);
});

test("CLI: learn mode check/status and reference tampering", () => {
  const project = makeRepo(FILES);
  const solution = makeSolution(project, CHANGES);
  run(project, "build", "--mode", "learn", "--solution", solution, "--out", ".line-by-line/learn");
  const dir = join(project, ".line-by-line", "learn");
  assert.ok(existsSync(join(dir, "holes-todo.txt")));
  assert.match(readFileSync(join(dir, "holes-todo.txt"), "utf8"), /app\/helper\.py:1-2/);
  author(dir, { holes: "## app/helper.py:2-2 ret\nReturn the answer.\n\n## go/tool.go:4-6 zero\nHandle a == 0.\n" });
  const ok = run(project, "assemble", dir);
  assert.match(ok.out, /VALID/, ok.out);
  assert.match(ok.out, /private\/rubric\.json is missing/);

  assert.match(run(project, "check", dir, "app/helper.py").out, /No submissions/);
  const subDir = join(dir, "submissions", encodeURIComponent("app/helper.py"));
  mkdirSync(subDir, { recursive: true });
  writeFileSync(join(subDir, "1.json"), JSON.stringify({ holes: { ret: "    return 41" } }));
  assert.match(run(project, "status", dir).out, /grade submission 1 of app\/helper\.py/);
  const checked = run(project, "check", dir, "app/helper.py");
  assert.equal(checked.code, 0, checked.out);
  assert.equal(readFileSync(join(dir, "check", "app", "helper.py"), "utf8"), "def helper():\n    return 41\n");
  assert.ok(!existsSync(join(dir, "check", ".git")), "check/ is a plain copy, not a second worktree");
  assert.match(checked.out, /grades\/files\/app%2Fhelper\.py\.json/);

  const ref = JSON.parse(readFileSync(join(dir, "private", "reference.json"), "utf8"));
  ref.zero = "\tif a == 1 {\n\t\treturn b\n\t}";
  writeFileSync(join(dir, "private", "reference.json"), JSON.stringify(ref));
  const bad = run(project, "validate", dir);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /go\/tool\.go: rebuilding the file doesn't give the solution byte for byte/);
});
