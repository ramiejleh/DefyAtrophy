import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { author, makeRepo, sh, writeFiles } from "./helpers.js";
import { startServer } from "./helpers.js";

const BIN = join(import.meta.dirname, "..", "..", "line-by-line", "cli", "line-by-line");
const run = (cwd, ...args) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const spawned = [];
after(() => spawned.forEach((s) => s.exitCode === null && s.kill("SIGKILL")));

const FILES = { "src/app.js": "export const a = 1;\n", "README.md": "# app\n" };
const FEATURE = { "src/app.js": "export const a = 1;\nexport const b = 2;\n", "src/new.js": "export const n = 3;\n" };

/** The lifecycle a /line-by-line:type run goes through: worktree, build, serve, game writes files, finish. */
async function playSession(project, slug) {
  const session = join(project, ".line-by-line", slug);
  sh(project, "git", ["worktree", "add", "--detach", join(session, "worktree"), "HEAD"]);
  writeFiles(join(session, "worktree"), FEATURE);
  assert.equal(run(project, "build", "--mode", "type", "--solution", join(session, "worktree"), "--out", session, "--task", slug).code, 0);
  author(session);
  assert.match(run(project, "assemble", session).out, /VALID/);
  const server = spawn(process.execPath, [BIN, "serve", "--session", session, "--no-open"], { cwd: project, stdio: "pipe" });
  spawned.push(server);
  await new Promise((r) => server.stdout.on("data", (d) => String(d).includes("LBL ready") && r()));
  return { session, server };
}

test("finish leaves the project exactly as if the feature had been written directly", async () => {
  const project = makeRepo(FILES);
  const { session, server } = await playSession(project, "add-b");
  // what the game does when the user finishes typing
  writeFiles(project, FEATURE);
  assert.ok(existsSync(join(session, "ACTIVE")));
  assert.match(readFileSync(join(project, ".git", "info", "exclude"), "utf8"), /^\.line-by-line\/$/m);

  const done = run(project, "finish", session);
  assert.equal(done.code, 0, done.out);
  assert.match(done.out, /stopped the game server/);
  assert.match(done.out, /removed the scratch worktree/);
  assert.match(done.out, /removed the \.git\/info\/exclude entry/);
  assert.match(done.out, /CLEAN/);
  await new Promise((r) => (server.exitCode !== null ? r() : server.on("exit", r)));
  assert.equal(alive(server.pid), false, "server stopped");

  assert.equal(existsSync(join(project, ".line-by-line")), false);
  assert.doesNotMatch(readFileSync(join(project, ".git", "info", "exclude"), "utf8"), /line-by-line/);
  assert.equal(sh(project, "git", ["worktree", "list"]).trim().split("\n").length, 1, "only the main worktree");
  assert.deepEqual(sh(project, "git", ["status", "--porcelain"]).replace(/\n$/, "").split("\n").sort(), ["?? src/new.js", " M src/app.js"].sort(), "only the feature's own changes");
  assert.equal(sh(project, "git", ["branch", "--list"]).trim(), "* main", "no extra branches");
});

test("finish keeps .line-by-line while other sessions remain, and never removes an exclude line it didn't add", async () => {
  const project = makeRepo(FILES);
  writeFileSync(join(project, ".git", "info", "exclude"), "# mine\n.line-by-line/\n");
  const one = await playSession(project, "one");
  const two = await playSession(project, "two");

  const first = run(project, "finish", one.session);
  assert.equal(first.code, 0, first.out);
  assert.match(first.out, /kept \.line-by-line\/: other sessions are still in it \(two\)/);
  assert.ok(alive(two.server.pid), "the other session's server keeps running");

  const second = run(project, "finish", two.session);
  assert.equal(second.code, 0, second.out);
  assert.equal(existsSync(join(project, ".line-by-line")), false);
  assert.equal(readFileSync(join(project, ".git", "info", "exclude"), "utf8"), "# mine\n.line-by-line/\n", "the user's own line stays");
  for (const s of [one.server, two.server]) await new Promise((r) => (s.exitCode !== null ? r() : s.on("exit", r)));
});

test("walkthrough: review mode over existing code, with line ranges", async () => {
  const lines = Array.from({ length: 30 }, (_, i) => `const v${i + 1} = ${i + 1};`).join("\n") + "\n";
  const project = makeRepo({ "src/auth/login.js": lines, "src/auth/token.js": "export function sign(user) {\n\treturn `t:${user}`;\n}\n", "README.md": "# x\n" });
  const session = join(project, ".line-by-line", "walkthrough-auth");

  const bad = run(project, "build", "--mode", "review", "--focus", "src/auth/login.js:25-40", "--out", session);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /range 25-40 is outside its 30 lines/);

  const built = run(project, "build", "--mode", "review", "--task", "the auth implementation", "--out", session, "--focus", "src/auth/login.js:5-8,20-21", "--focus", "src/auth/token.js");
  assert.equal(built.code, 0, built.out);
  assert.match(built.out, /2 files, 9 lines to step through/);
  const todo = readFileSync(join(session, "notes-todo.txt"), "utf8");
  assert.match(todo, /src\/auth\/login\.js:5\tconst v5 = 5;/);
  assert.doesNotMatch(todo, /login\.js:9\t/, "outside the ranges is context, not a stop");
  assert.match(todo, /src\/auth\/token\.js:2\t\treturn/, "tabs kept");

  author(session);
  const ok = run(project, "assemble", session);
  assert.match(ok.out, /VALID/, ok.out);
  const assembled = JSON.parse(readFileSync(join(session, "session.json"), "utf8"));
  assert.equal(assembled.subject, "code");
  assert.deepEqual(assembled.steps[0].files.map((f) => f.action), ["read", "read"]);

  // stepping through every file completes the session, so Claude knows to clean up
  const srv = await startServer(session, project);
  try {
    const files = Object.fromEntries(assembled.steps[0].files.map((f) => [f.path, { cursor: 0, done: false }]));
    await srv.call("PUT", "/api/progress", { files });
    assert.ok(!srv.events.includes("LBL complete"));
    for (const f of Object.values(files)) f.done = true;
    await srv.call("PUT", "/api/progress", { files });
    assert.ok(srv.events.includes("LBL complete"));
    assert.equal((await srv.call("POST", "/api/file", { path: "src/auth/token.js" })).status, 403, "walkthroughs never write");
  } finally {
    await srv.close();
  }
  assert.equal(sh(project, "git", ["status", "--porcelain"]).trim(), "", "the project is untouched");
  assert.match(run(project, "finish", session).out, /CLEAN/);
  assert.equal(existsSync(join(project, ".line-by-line")), false);
});

test("security: finish trusts no paths or pids from files a repository could ship", async () => {
  const { tmp } = await import("./helpers.js");
  const project = makeRepo(FILES);
  const { session, server } = await playSession(project, "evil");

  // a marker that names some other file must not make finish edit it
  const victim = join(tmp("lbl-victim-"), "victim.txt");
  writeFileSync(victim, "keep\n.line-by-line/\nkeep\n");
  writeFileSync(join(project, ".line-by-line", ".added-git-exclude"), victim);

  // a pid file that names an unrelated process must not get it killed
  const bystander = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"]);
  spawned.push(bystander);
  writeFileSync(join(session, "server.pid"), JSON.stringify({ pid: bystander.pid }));

  const done = run(project, "finish", session);
  assert.equal(done.code, 0, done.out);
  assert.equal(readFileSync(victim, "utf8"), "keep\n.line-by-line/\nkeep\n", "the named file is untouched");
  assert.ok(alive(bystander.pid), "the unrelated process is still running");
  assert.match(done.out, /stopped the game server \(pid \d+\)/, "the real server, found via ACTIVE, is still stopped");
  await new Promise((r) => (server.exitCode !== null ? r() : server.on("exit", r)));
  assert.doesNotMatch(readFileSync(join(project, ".git", "info", "exclude"), "utf8"), /line-by-line/, "the real exclude entry is removed");
});

test("security: --focus can't read outside the project", async () => {
  const { symlinkSync } = await import("node:fs");
  const { tmp } = await import("./helpers.js");
  const project = makeRepo(FILES);
  const outside = join(tmp("lbl-outside-"), "secret.txt");
  writeFileSync(outside, "secret\n");
  symlinkSync(outside, join(project, "link.txt"));
  for (const focus of ["../../../../../../etc/hosts", "link.txt"]) {
    const r = run(project, "build", "--mode", "review", "--focus", focus, "--out", ".line-by-line/x");
    assert.equal(r.code, 1, focus);
    assert.match(r.out, /doesn't exist in the project \(or is outside it\)/);
  }
});
