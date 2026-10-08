import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assemble, build } from "../lib/build.js";
import { dirSource, gitSource } from "../lib/sources.js";

export const tmp = (prefix = "lbl-") => mkdtempSync(join(tmpdir(), prefix));

export function writeFiles(dir, files) {
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    if (content === null) {
      rmSync(full, { force: true });
      continue;
    }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

export const sh = (cwd, cmd, args) => execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();

export function makeRepo(files) {
  const dir = tmp("lbl-project-");
  writeFiles(dir, files);
  sh(dir, "git", ["init", "-q", "-b", "main"]);
  sh(dir, "git", ["add", "-A"]);
  sh(dir, "git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  return dir;
}

export function makeSolution(project, changes) {
  const dir = tmp("lbl-solution-");
  cpSync(project, dir, { recursive: true, filter: (src) => !src.endsWith("/.git") });
  writeFiles(dir, changes);
  return dir;
}

/** Fills steps.json with one step (or the given layout) and writes a note for every todo line. */
export function author(sessionDir, { steps, holes, title = "Test session" } = {}) {
  const template = JSON.parse(readFileSync(join(sessionDir, "steps.json"), "utf8"));
  const base = template.steps[0];
  const layout = steps ?? [{ id: "01-all", files: base.files.map((f) => f.path) }];
  template.title = title;
  template.steps = layout.map((s, i) => ({
    ...base,
    id: s.id,
    title: `Step ${i + 1}`,
    goal: "Goal",
    reflectionPrompt: "Explain it",
    files: s.files.map((p, j) => ({ path: p, order: j + 1, role: `role of ${p}`, intro: "" })),
    autoApplied: i === 0 ? base.autoApplied : [],
    diagram: s.diagram ?? { context: [], edges: [] },
  }));
  writeFileSync(join(sessionDir, "steps.json"), JSON.stringify(template, null, 2));
  try {
    const todo = readFileSync(join(sessionDir, "notes-todo.txt"), "utf8");
    const notes = todo
      .split("\n")
      .filter((l) => l.includes("\t") && !l.startsWith("#"))
      .map((l) => `${l.split("\t")[0]}\tNote for ${l.split("\t")[0]}`);
    writeFileSync(join(sessionDir, "notes.txt"), notes.join("\n") + "\n");
  } catch {}
  if (holes) writeFileSync(join(sessionDir, "holes.txt"), holes);
}

/** project + solution → assembled session dir (type/learn). */
export function makeSession({ mode = "type", files, changes, steps, holes }) {
  const project = makeRepo(files);
  const solution = makeSolution(project, changes);
  const out = join(project, ".line-by-line", "test");
  build({ mode, from: dirSource(project), to: dirSource(solution), projectDir: project, out, task: "test task" });
  author(out, { steps, holes });
  const result = assemble(out);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return { project, solution, sessionDir: out };
}

/** A repo with a feature branch → assembled review session. */
export function makeReviewSession({ files, changes }) {
  const project = makeRepo(files);
  sh(project, "git", ["checkout", "-qb", "feature"]);
  writeFiles(project, changes);
  sh(project, "git", ["add", "-A"]);
  sh(project, "git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "feature"]);
  const base = sh(project, "git", ["merge-base", "main", "HEAD"]).trim();
  const out = join(project, ".line-by-line", "review");
  build({ mode: "review", from: gitSource(project, base), to: gitSource(project, "HEAD"), projectDir: project, out, base });
  author(out);
  const result = assemble(out);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return { project, sessionDir: out };
}

/** Starts a game server on a free port and returns a tiny client for it. */
export async function startServer(sessionDir, project) {
  const { createGameServer } = await import("../game/server.js");
  const events = [];
  const server = createGameServer({ sessionDir, projectDir: project, emit: (l) => events.push(l) });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", "X-LBL-Token": server.token, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  };
  return { server, base, events, call, close: () => new Promise((r) => {
      server.close(r);
      server.closeAllConnections();
    }) };
}
