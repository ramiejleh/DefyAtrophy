import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { tmp } from "./helpers.js";

const GUARD = join(import.meta.dirname, "..", "hooks", "guard.js");
const run = (root, file_path) => {
  const r = spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Edit", cwd: root, tool_input: { file_path } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: "utf8",
  });
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : "none";
};

test("guard: asks only while a session's server is alive, and only for project files", async () => {
  const root = tmp("lbl-guard-");
  mkdirSync(join(root, ".line-by-line", "s1"), { recursive: true });
  assert.equal(run(root, join(root, "src/a.ts")), "none", "no session: no opinion");

  const alive = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"]);
  writeFileSync(join(root, ".line-by-line", "s1", "ACTIVE"), JSON.stringify({ pid: alive.pid }));
  try {
    assert.equal(run(root, join(root, "src/a.ts")), "ask");
    assert.equal(run(root, "src/relative.ts"), "ask", "relative paths resolve against cwd");
    assert.equal(run(root, join(root, ".line-by-line", "s1", "worktree", "src/a.ts")), "none", "the scratch worktree is fine");
    assert.equal(run(root, "/somewhere/else.txt"), "none", "outside the project is not our business");
  } finally {
    alive.kill();
  }
  await new Promise((r) => alive.on("exit", r));
  assert.equal(run(root, join(root, "src/a.ts")), "none", "a dead server never blocks");
});
