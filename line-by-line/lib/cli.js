import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { assemble, build } from "./build.js";
import { SESSION_DIR, defaultBranch, dirSource, git, gitSource, isGitRepo } from "./sources.js";
import { allFiles, findFile, loadSession, readJson, rebuild, rows } from "./session.js";
import { validate } from "./validate.js";

const USAGE = `line-by-line <command>

  build     --mode type|learn|review [--project .] [--solution <dir>] [--base <ref>] [--task "..."] [--out <dir>]
  assemble  <session-dir>          merge steps.json + notes.txt / holes.txt into session.json, then validate
  validate  <session-dir>
  serve     --session <dir> [--project .] [--port 0] [--no-open]
  check     <session-dir> <path>   learn mode: put the latest submission into check/ for testing
  status    <session-dir>          progress, plus anything waiting for Claude
  list      [--project .]          sessions in this project
`;

const enc = (p) => encodeURIComponent(p);
const out = (...lines) => console.log(lines.join("\n"));

export function slugify(text) {
  return (
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "session"
  );
}

/** Keeps session data out of git without touching the user's tracked .gitignore. */
export function ignoreSessionDir(projectDir) {
  if (!isGitRepo(projectDir)) return;
  const exclude = resolve(projectDir, git(projectDir, ["rev-parse", "--git-path", "info/exclude"]).toString().trim());
  const current = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
  if (current.split(/\r?\n/).some((l) => l.trim() === `${SESSION_DIR}/` || l.trim() === SESSION_DIR)) return;
  mkdirSync(dirname(exclude), { recursive: true });
  appendFileSync(exclude, `${current && !current.endsWith("\n") ? "\n" : ""}${SESSION_DIR}/\n`);
}

const absolute = (p, base = process.cwd()) => (isAbsolute(p) ? p : resolve(base, p));

function cmdBuild(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      mode: { type: "string" },
      project: { type: "string", default: "." },
      solution: { type: "string" },
      base: { type: "string" },
      task: { type: "string", default: "" },
      out: { type: "string" },
    },
  });
  const projectDir = absolute(values.project);
  const mode = values.mode;
  let from;
  let to;
  let base = null;
  if (mode === "review") {
    if (!isGitRepo(projectDir)) throw new Error("Review mode needs a git repository");
    const ref = values.base ?? defaultBranch(projectDir);
    base = git(projectDir, ["merge-base", ref, "HEAD"]).toString().trim();
    from = gitSource(projectDir, base);
    to = gitSource(projectDir, "HEAD");
    if (from.ref === to.ref) throw new Error(`HEAD has no commits that aren't on ${ref}`);
  } else {
    if (!values.solution) throw new Error("--solution <dir> is required in type and learn mode");
    from = dirSource(projectDir);
    to = dirSource(absolute(values.solution));
  }
  const outDir = absolute(values.out ?? join(SESSION_DIR, slugify(values.task || mode)), projectDir);
  ignoreSessionDir(projectDir);
  const result = build({ mode, from, to, projectDir, out: outDir, task: values.task, base });
  out(
    `Built a ${mode} draft in ${outDir}`,
    `  ${result.files} files to ${mode === "review" ? "step through" : mode === "learn" ? "write" : "type"}, ${result.lines} changed lines, ${result.autoApplied} applied automatically`,
    "",
    "Next:",
    "  1. Fill in steps.json (titles, goals, file order and roles, diagram context and edges)",
    mode === "learn"
      ? "  2. Write holes.txt (see holes-todo.txt for the changed regions), and private/rubric.json"
      : `  2. Write notes.txt with a note for every line in notes-todo.txt${mode === "type" ? ", and private/rubric.json" : ""}`,
    `  3. line-by-line assemble ${outDir}`,
  );
}

function report({ errors, warnings, stats }) {
  for (const w of warnings) console.log(`warning: ${w}`);
  for (const e of errors) console.log(`error: ${e}`);
  if (stats) console.log(`${stats.steps} steps · ${stats.files} files · ${stats.typed} lines · ${stats.holes} holes`);
  console.log(errors.length ? `INVALID (${errors.length} error${errors.length > 1 ? "s" : ""})` : "VALID");
  if (errors.length) process.exitCode = 1;
}

function cmdAssemble([dir]) {
  if (!dir) throw new Error("Usage: line-by-line assemble <session-dir>");
  const result = assemble(absolute(dir));
  if (!result.ok) return report({ errors: result.errors, warnings: [] });
  report(validate(absolute(dir)));
}

export async function serveFromArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      session: { type: "string" },
      project: { type: "string" },
      port: { type: "string", default: "0" },
      "no-open": { type: "boolean", default: false },
    },
  });
  if (!values.session) throw new Error("--session <dir> is required");
  const sessionDir = absolute(values.session);
  const session = loadSession(sessionDir);
  const projectDir = absolute(values.project ?? session.projectDir);
  const { serve } = await import("../game/server.js");
  await serve({ sessionDir, projectDir, port: Number(values.port), open: !values["no-open"] });
  if (session.mode !== "review" && !existsSync(join(sessionDir, "complete"))) {
    // Read by the write-guard hook. It only counts while this process is alive.
    writeFileSync(join(sessionDir, "ACTIVE"), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const clear = () => rmSync(join(sessionDir, "ACTIVE"), { force: true });
    process.on("exit", clear);
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => process.exit(0));
  }
}

/** Learn mode: rebuild the latest submission inside check/, a copy of the reference solution. */
function cmdCheck([dir, path]) {
  if (!dir || !path) throw new Error("Usage: line-by-line check <session-dir> <path>");
  const sessionDir = absolute(dir);
  const session = loadSession(sessionDir);
  if (session.mode !== "learn") throw new Error("check is for learn sessions");
  const found = findFile(session, path);
  if (!found) throw new Error(`${path} isn't part of this session`);
  const subsDir = join(sessionDir, "submissions", enc(path));
  const subs = existsSync(subsDir) ? readdirSync(subsDir).filter((n) => /^\d+\.json$/.test(n)).map((n) => Number(n.split(".")[0])).sort((a, b) => a - b) : [];
  if (!subs.length) throw new Error(`No submissions for ${path} yet`);
  const attempt = subs.at(-1);
  const submission = readJson(join(subsDir, `${attempt}.json`), {});

  const checkDir = join(sessionDir, "check");
  if (!existsSync(checkDir)) {
    const solution = session.source.path;
    cpSync(solution, checkDir, {
      recursive: true,
      filter: (src) => {
        const name = basename(src);
        return name !== ".git" && !(name === "node_modules" && statSync(src).isDirectory());
      },
    });
    for (const nm of findNodeModules(solution)) {
      const rel = nm.slice(solution.length);
      mkdirSync(dirname(join(checkDir, rel)), { recursive: true });
      symlinkSync(nm, join(checkDir, rel));
    }
  }
  const content = rebuild(found.file, (id) => submission.holes?.[id]);
  const dest = join(checkDir, path);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content);

  const gradeFile = join(sessionDir, "grades", "files", `${enc(path)}.json`);
  out(
    `Attempt ${attempt} of ${path} is now at:`,
    `  ${dest}`,
    `Run the project's checks from ${checkDir}, then add this attempt's grade to:`,
    `  ${gradeFile}`,
    `as an entry in a JSON array: { "attempt": ${attempt}, "verdict": "pass" | "partial" | "retry", "score": 0-100, "feedback": "...", "comments": [{ "line": <line in the file above>, "text": "..." }] }`,
  );
}

function findNodeModules(root, depth = 0, found = []) {
  if (depth > 3 || !existsSync(root)) return found;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === ".git") continue;
    const full = join(root, entry.name);
    if (entry.name === "node_modules") found.push(full);
    else findNodeModules(full, depth + 1, found);
  }
  return found;
}

/** What's done, and what's waiting on Claude: ungraded reflections, submissions and hint requests. */
export function status(sessionDir) {
  const session = loadSession(sessionDir);
  const at = (...p) => join(sessionDir, ...p);
  const applied = readJson(at("applied.json"), {});
  const pending = [];
  const lines = [`${session.title} (${session.mode})`, `task: ${session.task}`];
  for (const [i, step] of session.steps.entries()) {
    lines.push(`step ${i + 1} ${step.id}: ${step.title}`);
    for (const file of step.files) {
      const typed = rows(file).filter((r) => r.kind === "typed" && r.text).length;
      lines.push(`  ${file.order}. ${file.path} ${file.path in applied ? "✓ written" : ""}${typed ? ` (${typed} lines)` : ""}`);
      if (session.mode === "learn") {
        const subsDir = at("submissions", enc(file.path));
        const n = existsSync(subsDir) ? readdirSync(subsDir).filter((x) => /^\d+\.json$/.test(x)).length : 0;
        const grades = [readJson(at("grades", "files", `${enc(file.path)}.json`), [])].flat();
        if (n && !grades.some((g) => g.attempt === n)) pending.push(`grade submission ${n} of ${file.path} (line-by-line check ${sessionDir} ${file.path})`);
      }
    }
    if (session.mode === "type") {
      const reflection = at("reflections", `${step.id}.md`);
      const grade = at("grades", "steps", `${step.id}.json`);
      if (existsSync(reflection) && (!existsSync(grade) || statSync(grade).mtimeMs < statSync(reflection).mtimeMs)) {
        pending.push(`grade the reflection for ${step.id}: ${reflection} → ${grade}`);
      }
    }
  }
  if (session.mode === "learn") {
    const requests = readJson(at("hint-requests.json"), []);
    for (const r of requests) {
      const given = [readJson(at("hints", `${enc(r.path)}.json`), [])].flat();
      if (!given.some((h) => h.holeId === r.holeId && h.at >= r.at)) pending.push(`hint for ${r.path} hole ${r.holeId}`);
    }
  }
  const complete = existsSync(at("complete"));
  return { lines, pending, complete, session };
}

function cmdStatus([dir]) {
  if (!dir) throw new Error("Usage: line-by-line status <session-dir>");
  const { lines, pending, complete } = status(absolute(dir));
  out(...lines, "", complete ? "COMPLETE" : "in progress");
  out(pending.length ? `\nWaiting for Claude:\n${pending.map((p) => `  - ${p}`).join("\n")}` : "\nNothing waiting for Claude.");
}

function cmdList(argv) {
  const { values } = parseArgs({ args: argv, options: { project: { type: "string", default: "." } } });
  const root = join(absolute(values.project), SESSION_DIR);
  const dirs = existsSync(root) ? readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()) : [];
  if (!dirs.length) return out("No line-by-line sessions in this project.");
  for (const d of dirs) {
    const dir = join(root, d.name);
    if (!existsSync(join(dir, "session.json"))) {
      out(`${d.name}  (draft, not assembled yet)`);
      continue;
    }
    const { pending, complete, session } = status(dir);
    const files = allFiles(session).length;
    const done = Object.keys(readJson(join(dir, "applied.json"), {})).length;
    const active = readJson(join(dir, "ACTIVE"), null);
    out(
      `${d.name}  ${session.mode}  "${session.title}"  ${complete ? "complete" : session.mode === "review" ? "" : `${Math.min(done, files)}/${files} files written`}` +
        `${pending.length ? `  ${pending.length} waiting for Claude` : ""}${active ? "  [server running]" : ""}${existsSync(join(dir, "worktree")) ? "  [worktree]" : ""}`,
    );
  }
}

export async function main(argv) {
  const [command, ...rest] = argv;
  try {
    if (command === "build") return cmdBuild(rest);
    if (command === "assemble") return cmdAssemble(rest);
    if (command === "validate") return report(validate(absolute(rest[0] ?? ".")));
    if (command === "serve") return await serveFromArgs(rest);
    if (command === "check") return cmdCheck(rest);
    if (command === "status") return cmdStatus(rest);
    if (command === "list") return cmdList(rest);
    out(USAGE);
    if (command && command !== "help" && command !== "--help") process.exitCode = 1;
  } catch (error) {
    console.error(`line-by-line ${command}: ${error.message}`);
    process.exitCode = 1;
  }
}
