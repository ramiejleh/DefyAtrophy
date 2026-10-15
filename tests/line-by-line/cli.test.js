import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { author, makeRepo, makeSolution, sh, tmp, writeFiles } from "./helpers.js";

const BIN = join(import.meta.dirname, "..", "..", "line-by-line", "cli", "line-by-line");
const runEnv = (env, cwd, ...args) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8", env });
  return { code: r.status, out: r.stdout + r.stderr };
};
const run = (cwd, ...args) => runEnv(process.env, cwd, ...args);
// a PATH with nothing on it, so `git` can't be found
const noGit = (cwd, ...args) => runEnv({ ...process.env, PATH: tmp("lbl-empty-path-") }, cwd, ...args);

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

test("CLI: scratch + type session in a folder that isn't a git repository", () => {
  const project = tmp("lbl-plain-");
  writeFiles(project, { ...FILES, "node_modules/dep/index.js": "module.exports = 1;\n" });
  const made = run(project, "scratch", ".line-by-line/plain");
  assert.equal(made.code, 0, made.out);
  assert.match(made.out, /SCRATCH copy/);
  const worktree = join(project, ".line-by-line", "plain", "worktree");
  assert.ok(!existsSync(join(worktree, ".line-by-line")), "the copy doesn't contain the session folder");
  assert.ok(lstatSync(join(worktree, "node_modules")).isSymbolicLink(), "node_modules is linked, not copied");
  assert.equal(readFileSync(join(worktree, "app", "main.py"), "utf8"), FILES["app/main.py"]);

  writeFiles(worktree, { "app/helper.py": CHANGES["app/helper.py"] });
  const built = run(project, "build", "--mode", "type", "--solution", worktree, "--out", ".line-by-line/plain");
  assert.equal(built.code, 0, built.out);
  assert.match(built.out, /1 files to type/, "only the edited file differs from the project");
  author(join(project, ".line-by-line", "plain"));
  assert.match(run(project, "assemble", ".line-by-line/plain").out, /VALID/);
  const done = run(project, "finish", ".line-by-line/plain");
  assert.match(done.out, /CLEAN/, done.out);
  assert.ok(!existsSync(join(project, ".line-by-line")));
});

test("CLI: scratch copies (without ignored files) in a git repository with no commits", () => {
  const project = tmp("lbl-fresh-");
  writeFiles(project, { ...FILES, ".gitignore": "dist/\n", "dist/out.js": "built\n" });
  sh(project, "git", ["init", "-q", "-b", "main"]);
  const made = run(project, "scratch", ".line-by-line/fresh");
  assert.equal(made.code, 0, made.out);
  assert.match(made.out, /SCRATCH copy/);
  const worktree = join(project, ".line-by-line", "fresh", "worktree");
  assert.ok(!existsSync(join(worktree, "dist")), "ignored files aren't copied");
  writeFiles(worktree, { "app/helper.py": CHANGES["app/helper.py"] });
  const built = run(project, "build", "--mode", "type", "--solution", worktree, "--out", ".line-by-line/fresh");
  assert.equal(built.code, 0, built.out);
  assert.match(built.out, /1 files to type/);
  assert.match(run(project, "finish", ".line-by-line/fresh").out, /CLEAN/);
});

test("CLI: scratch makes a git worktree when there's a commit, and finish removes it", () => {
  const project = makeRepo(FILES);
  const made = run(project, "scratch", ".line-by-line/wt");
  assert.equal(made.code, 0, made.out);
  assert.match(made.out, /SCRATCH worktree/);
  assert.match(sh(project, "git", ["worktree", "list"]), /\.line-by-line\/wt\/worktree/);
  assert.match(run(project, "scratch", ".line-by-line/wt").out, /already exists/);
  writeFiles(join(project, ".line-by-line", "wt"), { "draft.json": "{}" });
  assert.match(run(project, "finish", ".line-by-line/wt").out, /CLEAN/);
  assert.doesNotMatch(sh(project, "git", ["worktree", "list"]), /\.line-by-line/);
});

test("CLI: learn mode end to end without git installed", () => {
  const project = tmp("lbl-nogit-");
  writeFiles(project, FILES);
  const made = noGit(project, "scratch", ".line-by-line/learn");
  assert.equal(made.code, 0, made.out);
  assert.match(made.out, /SCRATCH copy/);
  const dir = join(project, ".line-by-line", "learn");
  writeFiles(join(dir, "worktree"), { "app/helper.py": CHANGES["app/helper.py"] });
  const built = noGit(project, "build", "--mode", "learn", "--solution", join(dir, "worktree"), "--out", ".line-by-line/learn");
  assert.equal(built.code, 0, built.out);
  author(dir, { holes: "## app/helper.py:2-2 ret\nReturn the answer.\n" });
  assert.match(noGit(project, "assemble", dir).out, /VALID/);
  const subDir = join(dir, "submissions", encodeURIComponent("app/helper.py"));
  mkdirSync(subDir, { recursive: true });
  writeFileSync(join(subDir, "1.json"), JSON.stringify({ holes: { ret: "    return 42" } }));
  const checked = noGit(project, "check", dir, "app/helper.py");
  assert.equal(checked.code, 0, checked.out);
  assert.equal(readFileSync(join(dir, "check", "app", "helper.py"), "utf8"), CHANGES["app/helper.py"]);
  assert.match(noGit(project, "finish", dir).out, /CLEAN/);
  assert.ok(!existsSync(join(project, ".line-by-line")));
});
