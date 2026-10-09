import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { validate } from "../../line-by-line/lib/validate.js";
import { makeReviewSession, makeSession, startServer } from "./helpers.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1, 2, 3]);

const FILES = {
  "src/app.ts": "import { a } from './a';\n\nexport function run() {\n  return a();\n}\n",
  "win.txt": "first\r\nsecond\r\n",
  "main.go": "package main\n\nfunc main() {\n\tprintln(1)\n}\n",
  "old.py": "print('bye')\n",
  "img.png": PNG,
  "tail.txt": "no newline",
};
const CHANGES = {
  "src/app.ts": "import { a } from './a';\nimport { b } from './b';\n\nexport function run() {\n  return a() + b();\n}\n",
  "src/b.ts": "export const b = () => 2;\n",
  "win.txt": "first\r\n  second!\r\nthird\r\n",
  "main.go": "package main\n\nfunc main() {\n\tfor i := 0; i < 2; i++ {\n\t\tprintln(i)\n\t}\n}\n",
  "old.py": null,
  "img.png": Buffer.concat([PNG, Buffer.from([9])]),
  "tail.txt": "no newline\nstill none",
};

test("type mode: every kind of file lands byte for byte", async () => {
  const { project, solution, sessionDir } = makeSession({ files: FILES, changes: CHANGES });
  const { errors } = validate(sessionDir);
  assert.deepEqual(errors, []);
  const srv = await startServer(sessionDir, project);
  try {
    const session = (await srv.call("GET", "/api/session")).body;
    const paths = session.steps.flatMap((s) => s.files.map((f) => f.path));
    assert.deepEqual(paths.sort(), ["main.go", "old.py", "src/app.ts", "src/b.ts", "tail.txt", "win.txt"]);
    assert.deepEqual(session.steps[0].autoApplied.map((a) => a.path), ["img.png"]);

    for (const path of paths) {
      const res = await srv.call("POST", "/api/file", { path });
      assert.equal(res.status, 200, JSON.stringify(res.body));
    }
    assert.equal((await srv.call("POST", "/api/step-done", { stepId: session.steps[0].id })).status, 200);

    for (const path of ["src/app.ts", "src/b.ts", "win.txt", "main.go", "img.png", "tail.txt"]) {
      assert.ok(readFileSync(join(project, path)).equals(readFileSync(join(solution, path))), path);
    }
    assert.equal(existsSync(join(project, "old.py")), false);
    assert.ok(srv.events.includes("LBL file src/b.ts"));
    assert.ok(srv.events.includes(`LBL step-done ${session.steps[0].id}`));
    assert.ok(!srv.events.includes("LBL complete"), "not complete before the reflection");

    const short = await srv.call("POST", "/api/reflection", { stepId: session.steps[0].id, text: "too short" });
    assert.equal(short.status, 400);
    const ok = await srv.call("POST", "/api/reflection", { stepId: session.steps[0].id, text: "x".repeat(130) });
    assert.equal(ok.status, 200);
    assert.ok(srv.events.includes(`LBL reflection ${session.steps[0].id}`));
    assert.ok(srv.events.includes("LBL complete"));
    assert.equal((await srv.call("GET", "/api/state")).body.complete, true);
  } finally {
    await srv.close();
  }
});

test("a file changed on disk returns 409 until forced", async () => {
  const { project, solution, sessionDir } = makeSession({ files: FILES, changes: CHANGES });
  writeFileSync(join(project, "src/app.ts"), "// edited by the user\n");
  const srv = await startServer(sessionDir, project);
  try {
    const state = (await srv.call("GET", "/api/state")).body;
    assert.deepEqual(state.conflicts, ["src/app.ts"]);
    const res = await srv.call("POST", "/api/file", { path: "src/app.ts" });
    assert.equal(res.status, 409);
    assert.equal(res.body.conflict.path, "src/app.ts");
    const disk = await srv.call("GET", `/api/disk?path=${encodeURIComponent("src/app.ts")}`);
    assert.equal(disk.body.content, "// edited by the user\n");
    assert.equal((await srv.call("POST", "/api/file", { path: "src/app.ts", force: true })).status, 200);
    assert.equal(readFileSync(join(project, "src/app.ts"), "utf8"), readFileSync(join(solution, "src/app.ts"), "utf8"));
    assert.equal((await srv.call("POST", "/api/file", { path: "src/app.ts" })).status, 200, "rewriting our own write is not a conflict");
  } finally {
    await srv.close();
  }
});

test("security: token, host, private files and traversal", async () => {
  const { project, sessionDir } = makeSession({ files: FILES, changes: CHANGES });
  mkdirSync(join(sessionDir, "private"), { recursive: true });
  writeFileSync(join(sessionDir, "private", "rubric.json"), '{"secret":"rubric"}');
  const srv = await startServer(sessionDir, project);
  try {
    assert.equal((await srv.call("GET", "/api/session", undefined, { "X-LBL-Token": "nope" })).status, 403);
    const noToken = await fetch(`${srv.base}/api/state`);
    assert.equal(noToken.status, 403);
    const rebound = await new Promise((done) => {
      const req = request(`${srv.base}/api/session`, { headers: { Host: "evil.example", "X-LBL-Token": srv.server.token } }, (res) => {
        res.resume();
        done(res.statusCode);
      });
      req.end();
    });
    assert.equal(rebound, 403, "DNS rebinding: a non-local Host header is refused");

    const session = JSON.stringify((await srv.call("GET", "/api/session")).body);
    assert.ok(!session.includes("secret"));
    for (const path of ["/private/rubric.json", "/../private/rubric.json", "/%2e%2e/%2e%2e/package.json", "/..%2f..%2fpackage.json"]) {
      const res = await fetch(srv.base + path);
      assert.equal(res.status, 404, path);
    }
    assert.equal((await srv.call("GET", "/api/disk?path=../../../etc/passwd")).status, 400);
    assert.equal((await srv.call("POST", "/api/file", { path: "../outside.txt" })).status, 400);
    assert.equal((await srv.call("POST", "/api/file", { path: "src/app.ts" }, { "X-LBL-Token": "" })).status, 403);
  } finally {
    await srv.close();
  }
});

test("validate catches tampering", () => {
  const { sessionDir } = makeSession({ files: FILES, changes: CHANGES });
  const file = join(sessionDir, "session.json");
  const session = JSON.parse(readFileSync(file, "utf8"));
  const typed = session.steps[0].files.find((f) => f.path === "src/b.ts").segments.find((s) => s.kind === "typed");
  typed.lines[0].text += " // tampered";
  writeFileSync(file, JSON.stringify(session));
  const { errors } = validate(sessionDir);
  assert.ok(errors.some((e) => e.includes("src/b.ts") && e.includes("byte for byte")), errors.join("\n"));
});

test("validate catches a missing note and a project that changed", () => {
  const { project, sessionDir } = makeSession({ files: FILES, changes: CHANGES });
  const file = join(sessionDir, "session.json");
  const session = JSON.parse(readFileSync(file, "utf8"));
  delete session.steps[0].files.find((f) => f.path === "src/b.ts").segments.find((s) => s.kind === "typed").lines[0].note;
  writeFileSync(file, JSON.stringify(session));
  writeFileSync(join(project, "main.go"), "changed\n");
  const { errors } = validate(sessionDir);
  assert.ok(errors.some((e) => e.includes("src/b.ts: no note for line 1")), errors.join("\n"));
  assert.ok(errors.some((e) => e.includes("main.go: changed in the project")), errors.join("\n"));
});

test("review mode: built from git, never writes", async () => {
  const { project, sessionDir } = makeReviewSession({ files: FILES, changes: CHANGES });
  assert.deepEqual(validate(sessionDir).errors, []);
  const srv = await startServer(sessionDir, project);
  try {
    const session = (await srv.call("GET", "/api/session")).body;
    assert.equal(session.mode, "review");
    const removed = session.steps[0].files.find((f) => f.path === "old.py");
    assert.equal(removed.action, "delete");
    assert.ok(removed.segments.every((s) => s.kind === "removed"));
    for (const [route, body] of [
      ["/api/file", { path: "src/b.ts" }],
      ["/api/step-done", { stepId: session.steps[0].id }],
      ["/api/reflection", { stepId: session.steps[0].id, text: "x".repeat(200) }],
      ["/api/submit", { path: "src/b.ts", holes: {} }],
    ]) {
      assert.equal((await srv.call("POST", route, body)).status, 403, route);
    }
  } finally {
    await srv.close();
  }
});

test("learn mode: submit, grade, apply, reveal", async () => {
  const holes = "## src/app.ts:5-5 body\nReturn the sum of a() and b().\n\n## src/b.ts:1-1 b\nExport b, which returns 2.\n";
  const { project, solution, sessionDir } = makeSession({
    mode: "learn",
    files: { "src/app.ts": FILES["src/app.ts"] },
    changes: { "src/app.ts": CHANGES["src/app.ts"], "src/b.ts": CHANGES["src/b.ts"] },
    holes,
  });
  assert.deepEqual(validate(sessionDir).errors, []);
  const srv = await startServer(sessionDir, project);
  try {
    const session = (await srv.call("GET", "/api/session")).body;
    assert.ok(!JSON.stringify(session).includes("a() + b()"), "the reference never reaches the browser");
    const app = session.steps[0].files.find((f) => f.path === "src/app.ts");
    assert.deepEqual(app.segments.map((s) => s.kind), ["given", "removed", "hole", "given"]);
    assert.ok(app.segments[0].lines.some((l) => l.added), "new lines outside holes are provided and marked added");

    assert.equal((await srv.call("POST", "/api/submit", { path: "src/app.ts", holes: {} })).status, 400);
    const sub = await srv.call("POST", "/api/submit", { path: "src/app.ts", holes: { body: "  return a() - b();" } });
    assert.equal(sub.body.attempt, 1);
    assert.ok(srv.events.includes(`LBL submit ${session.steps[0].id} src/app.ts 1`));
    assert.equal((await srv.call("POST", "/api/apply", { path: "src/app.ts" })).status, 400, "ungraded can't be applied");
    assert.equal((await srv.call("POST", "/api/reveal", { path: "src/app.ts", holeId: "body" })).status, 403);

    const gradeFile = join(sessionDir, "grades", "files", `${encodeURIComponent("src/app.ts")}.json`);
    mkdirSync(join(sessionDir, "grades", "files"), { recursive: true });
    const grades = [1, 2, 3].map((attempt) => ({ attempt, verdict: "retry", score: 20, feedback: "Subtracts", comments: [{ line: 5, text: "minus?" }] }));
    writeFileSync(gradeFile, JSON.stringify(grades));
    const reveal = await srv.call("POST", "/api/reveal", { path: "src/app.ts", holeId: "body" });
    assert.equal(reveal.status, 200);
    assert.equal(reveal.body.text, "  return a() + b();");

    await srv.call("POST", "/api/submit", { path: "src/app.ts", holes: { body: "  return a() + b();" } });
    await srv.call("POST", "/api/submit", { path: "src/app.ts", holes: { body: "  return a() + b();" } });
    await srv.call("POST", "/api/submit", { path: "src/app.ts", holes: { body: "  return a() + b();" } });
    writeFileSync(gradeFile, JSON.stringify([...grades, { attempt: 4, verdict: "pass", score: 95, feedback: "Yes", comments: [] }]));
    assert.equal((await srv.call("POST", "/api/apply", { path: "src/app.ts" })).status, 200);
    assert.equal(readFileSync(join(project, "src/app.ts"), "utf8"), readFileSync(join(solution, "src/app.ts"), "utf8"));

    const hint = await srv.call("POST", "/api/hint", { path: "src/b.ts", holeId: "b" });
    assert.equal(hint.status, 200);
    assert.ok(srv.events.some((e) => e.startsWith("LBL hint") && e.endsWith("src/b.ts b")));
  } finally {
    await srv.close();
  }
});

test("security: symlinks can't redirect writes outside the project", async () => {
  const { symlinkSync } = await import("node:fs");
  const { tmp } = await import("./helpers.js");
  const { project, sessionDir } = makeSession({ files: FILES, changes: CHANGES });
  const elsewhere = tmp("lbl-outside-");
  rmSync(join(project, "src"), { recursive: true, force: true });
  symlinkSync(elsewhere, join(project, "src"));
  writeFileSync(join(elsewhere, "app.ts"), FILES["src/app.ts"]);
  const srv = await startServer(sessionDir, project);
  try {
    const res = await srv.call("POST", "/api/file", { path: "src/b.ts", force: true });
    assert.equal(res.status, 400);
    assert.equal(existsSync(join(elsewhere, "b.ts")), false);
    symlinkSync(join(elsewhere, "app.ts"), join(project, "tail.txt.link"));
    rmSync(join(project, "tail.txt"));
    symlinkSync(join(elsewhere, "app.ts"), join(project, "tail.txt"));
    assert.equal((await srv.call("POST", "/api/file", { path: "tail.txt", force: true })).status, 400);
    assert.equal(readFileSync(join(elsewhere, "app.ts"), "utf8"), FILES["src/app.ts"]);

    // A dangling symlink must not be followed either (existsSync reports it as absent).
    rmSync(join(project, "tail.txt"));
    symlinkSync(join(elsewhere, "created-by-game.txt"), join(project, "tail.txt"));
    assert.equal((await srv.call("POST", "/api/file", { path: "tail.txt", force: true })).status, 400);
    assert.equal(existsSync(join(elsewhere, "created-by-game.txt")), false);
    rmSync(join(project, "src"));
    symlinkSync(join(elsewhere, "missing-dir"), join(project, "src"));
    assert.equal((await srv.call("POST", "/api/file", { path: "src/b.ts", force: true })).status, 400);
    assert.equal(existsSync(join(elsewhere, "missing-dir")), false);
  } finally {
    await srv.close();
  }
});
