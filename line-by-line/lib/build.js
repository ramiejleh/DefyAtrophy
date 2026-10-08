import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { diffLines } from "./diff.js";
import { MODES, lineString, rows, sha256, splitContent } from "./session.js";
import { changedBetween } from "./sources.js";

const LOCKFILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "Cargo.lock", "poetry.lock", "uv.lock",
  "Pipfile.lock", "Gemfile.lock", "composer.lock", "go.sum", "flake.lock", "mix.lock", "pubspec.lock",
]);
const GENERATED = /(^|\/)(dist|build|out|\.next|coverage|node_modules|__pycache__|target)\/|\.min\.(js|css)$|\.map$/;
const MAX_LINES = 1500;

const LANGUAGES = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript", json: "json",
  py: "python", pyi: "python", go: "go", rs: "rust",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", hpp: "cpp", java: "java", cs: "csharp", kt: "kotlin", scala: "scala", swift: "swift",
  css: "css", scss: "scss", less: "less", html: "html", htm: "html", vue: "html", svelte: "html", xml: "xml", svg: "xml",
  yml: "yaml", yaml: "yaml", md: "markdown", mdx: "markdown", sh: "shell", bash: "shell", zsh: "shell",
  sql: "sql", rb: "ruby", toml: "toml", ini: "plain", txt: "plain",
};

export function languageOf(path) {
  const name = basename(path);
  if (name === "Makefile" || name.endsWith(".mk")) return "makefile";
  if (name === "Dockerfile") return "shell";
  const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  return LANGUAGES[ext] ?? "plain";
}

/** The indent width the file seems to use: tabs → 4, otherwise the smallest space step (2 or 4). */
function tabSizeOf(lines, language) {
  if (language === "go" || language === "makefile" || lines.some((l) => l.indent.includes("\t"))) return 4;
  const widths = lines.map((l) => l.indent.length).filter((n) => n > 0);
  return widths.length && Math.min(...widths) >= 4 ? 4 : 2;
}

function untypeableReason(path, buf, split) {
  if (LOCKFILES.has(basename(path))) return "lockfile";
  if (GENERATED.test(path)) return "generated";
  const head = buf.subarray(0, 8000);
  if (head.includes(0) || !Buffer.from(buf.toString("utf8"), "utf8").equals(buf)) return "binary";
  if (split.mixed) return "mixed line endings";
  if (split.lines.length > MAX_LINES) return `over ${MAX_LINES} lines`;
  return null;
}

/** Turns a diff between two versions of a file into display segments. */
export function segmentsFor(oldContent, newContent) {
  const oldLines = oldContent === null ? [] : splitContent(oldContent).lines;
  const newLines = newContent === null ? [] : splitContent(newContent).lines;
  const ops = diffLines(oldLines.map(lineString), newLines.map(lineString));
  const segments = [];
  for (const op of ops) {
    const kind = op.op === "equal" ? "given" : op.op === "delete" ? "removed" : "typed";
    const line = kind === "removed" ? oldLines[op.a] : newLines[op.b];
    const last = segments[segments.length - 1];
    if (last?.kind === kind) last.lines.push({ ...line });
    else segments.push({ kind, lines: [{ ...line }] });
  }
  return segments;
}

/**
 * Diffs `from` (what's there now) against `to` (the solution, or HEAD in review mode) and writes a draft
 * session plus the to-do lists Claude fills in.
 */
export function build({ mode, from, to, projectDir, out, task = "", base = null }) {
  if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join(", ")}`);
  const paths =
    from.kind === "git" && to.kind === "git" ? changedBetween(from, to).sort() : [...new Set([...from.list(), ...to.list()])].sort();
  const files = [];
  const autoApplied = [];
  for (const path of paths) {
    const before = from.read(path);
    const after = to.read(path);
    if (before && after && before.equals(after)) continue;
    if (!before && !after) continue;
    const action = !before ? "create" : !after ? "delete" : "modify";
    const baseHash = before ? sha256(before) : null;
    const targetHash = after ? sha256(after) : null;
    const probe = after ?? before;
    const split = splitContent(probe.toString("utf8"));
    const reason = untypeableReason(path, probe, split) ?? (before && untypeableReason(path, before, splitContent(before.toString("utf8"))));
    if (reason) {
      autoApplied.push({ path, action: after ? "write" : "delete", reason, baseHash, targetHash });
      continue;
    }
    const language = languageOf(path);
    const newSplit = after ? splitContent(after.toString("utf8")) : splitContent(before.toString("utf8"));
    files.push({
      path,
      action,
      language,
      tabSize: tabSizeOf(newSplit.lines, language),
      eol: newSplit.eol,
      finalNewline: after ? newSplit.finalNewline : false,
      baseHash,
      targetHash,
      segments: segmentsFor(before?.toString("utf8") ?? null, after?.toString("utf8") ?? null),
    });
  }

  mkdirSync(out, { recursive: true });
  const draft = {
    version: 1,
    mode,
    task,
    projectDir,
    createdAt: new Date().toISOString(),
    source: to.kind === "git" ? { kind: "git", ref: to.ref } : { kind: "dir", path: to.path },
    base,
    autoApplied,
    files,
  };
  writeFileSync(join(out, "draft.json"), JSON.stringify(draft, null, 2));

  const stepsFile = join(out, "steps.json");
  if (!existsSync(stepsFile)) {
    const template = {
      title: "",
      steps: [
        {
          id: "01-first-step",
          title: "",
          tagline: "",
          goal: "",
          concepts: [],
          ...(mode === "review" ? {} : { setup: [], tryIt: [] }),
          ...(mode === "type" ? { reflectionPrompt: "" } : {}),
          files: files.map((f, i) => ({ path: f.path, order: i + 1, role: "", intro: "" })),
          autoApplied: autoApplied.map((a) => a.path),
          diagram: { context: [], edges: [] },
        },
      ],
    };
    writeFileSync(stepsFile, JSON.stringify(template, null, 2));
  }

  const todo = [];
  for (const f of files) {
    todo.push(`# ${f.path} (${f.action})`);
    for (const r of rows(f)) {
      if (r.text === "") continue;
      if (r.kind === "typed") todo.push(`${f.path}:${r.newNo}\t${r.indent}${r.text}`);
      if (r.kind === "removed" && mode === "review") todo.push(`${f.path}:-${r.oldNo}\t${r.indent}${r.text}`);
    }
  }
  if (mode === "learn") {
    const holes = [];
    for (const f of files) {
      const typed = rows(f).filter((r) => r.kind === "typed");
      let run = [];
      const flush = () => {
        if (run.length) holes.push(`${f.path}:${run[0].newNo}-${run[run.length - 1].newNo}`, ...run.map((r) => `  | ${r.indent}${r.text}`), "");
        run = [];
      };
      for (const r of typed) {
        if (run.length && r.newNo !== run[run.length - 1].newNo + 1) flush();
        run.push(r);
      }
      flush();
    }
    writeFileSync(join(out, "holes-todo.txt"), holes.join("\n") + "\n");
  } else {
    writeFileSync(join(out, "notes-todo.txt"), todo.join("\n") + "\n");
  }

  return { files: files.length, autoApplied: autoApplied.length, lines: files.reduce((n, f) => n + rows(f).filter((r) => r.kind === "typed" && r.text).length, 0) };
}

/** Parses `path:N<TAB>note` lines. Negative N addresses a removed line by its old line number. */
export function parseNotes(text) {
  const notes = new Map();
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.startsWith("#")) continue;
    const tab = raw.indexOf("\t");
    if (tab === -1) continue;
    const key = raw.slice(0, tab);
    const colon = key.lastIndexOf(":");
    if (colon === -1 || !/^-?\d+$/.test(key.slice(colon + 1))) continue;
    notes.set(`${key.slice(0, colon)}:${Number(key.slice(colon + 1))}`, raw.slice(tab + 1).trim().replace(/\\n/g, "\n"));
  }
  return notes;
}

/** Parses `## path:start-end [id]` headers, each followed by the hole's spec (markdown). */
export function parseHoles(text) {
  const holes = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^## (.+):(\d+)-(\d+)(?:\s+(\S+))?\s*$/);
    if (m) {
      current = { path: m[1], start: Number(m[2]), end: Number(m[3]), id: m[4] ?? null, spec: [] };
      holes.push(current);
    } else if (current) current.spec.push(raw);
  }
  return holes.map((h, i) => ({ ...h, id: h.id ?? `h${i + 1}`, spec: h.spec.join("\n").trim() }));
}

/** Learn mode: replaces line ranges (new-file numbering) with holes; other new lines become provided lines. */
export function applyHoles(file, ranges, reference) {
  const all = rows(file);
  const removedBefore = new Map();
  let pendingRemoved = [];
  const newRows = [];
  for (const r of all) {
    if (r.kind === "removed") pendingRemoved.push(r);
    else {
      if (pendingRemoved.length) removedBefore.set(r.newNo, pendingRemoved);
      pendingRemoved = [];
      newRows.push(r);
    }
  }
  const trailingRemoved = pendingRemoved;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start <= sorted[i - 1].end) throw new Error(`${file.path}: holes ${sorted[i - 1].id} and ${sorted[i].id} overlap`);
  }
  const segments = [];
  const push = (kind, line) => {
    const last = segments[segments.length - 1];
    const clean = { indent: line.indent, text: line.text, trail: line.trail, ...(kind === "given" && line.kind === "typed" ? { added: true } : {}) };
    if (last?.kind === kind) last.lines.push(clean);
    else segments.push({ kind, lines: [clean] });
  };
  let i = 0;
  for (const range of sorted) {
    if (range.start < 1 || range.end > newRows.length || range.end < range.start) {
      throw new Error(`${file.path}: hole ${range.id} (${range.start}-${range.end}) is outside the file's ${newRows.length} lines`);
    }
    for (; i < range.start - 1; i++) {
      for (const rm of removedBefore.get(newRows[i].newNo) ?? []) push("removed", rm);
      push("given", newRows[i]);
    }
    const inside = newRows.slice(range.start - 1, range.end);
    for (const r of inside) for (const rm of removedBefore.get(r.newNo) ?? []) push("removed", rm);
    reference[range.id] = inside.map(lineString).join("\n");
    segments.push({ kind: "hole", id: range.id, spec: range.spec, indent: inside[0].indent, lineCount: inside.length });
    i = range.end;
  }
  for (; i < newRows.length; i++) {
    for (const rm of removedBefore.get(newRows[i].newNo) ?? []) push("removed", rm);
    push("given", newRows[i]);
  }
  for (const rm of trailingRemoved) push("removed", rm);
  return segments;
}

/** Merges steps.json, notes.txt and holes.txt into session.json (+ private/reference.json in learn mode). */
export function assemble(dir) {
  const draft = JSON.parse(readFileSync(join(dir, "draft.json"), "utf8"));
  const plan = JSON.parse(readFileSync(join(dir, "steps.json"), "utf8"));
  const byPath = new Map(draft.files.map((f) => [f.path, f]));
  const autoByPath = new Map(draft.autoApplied.map((a) => [a.path, a]));
  const errors = [];

  let notes = new Map();
  if (draft.mode !== "learn") {
    const notesFile = join(dir, "notes.txt");
    if (existsSync(notesFile)) notes = parseNotes(readFileSync(notesFile, "utf8"));
    else errors.push("notes.txt is missing");
  }

  const reference = {};
  let holesByPath = new Map();
  if (draft.mode === "learn") {
    const holesFile = join(dir, "holes.txt");
    if (!existsSync(holesFile)) errors.push("holes.txt is missing");
    else {
      const holes = parseHoles(readFileSync(holesFile, "utf8"));
      const ids = new Set();
      for (const h of holes) {
        if (ids.has(h.id)) errors.push(`hole id ${h.id} is used twice`);
        ids.add(h.id);
        if (!byPath.has(h.path)) errors.push(`holes.txt names ${h.path}, which isn't a changed file`);
        holesByPath.set(h.path, [...(holesByPath.get(h.path) ?? []), h]);
      }
    }
  }

  const assignedAuto = new Set(plan.steps.flatMap((s) => s.autoApplied ?? []));
  const steps = plan.steps.map((s, si) => {
    const files = (s.files ?? []).map((entry) => {
      const draftFile = byPath.get(entry.path);
      if (!draftFile) {
        errors.push(`step ${s.id}: ${entry.path} isn't a changed file`);
        return null;
      }
      const file = { ...draftFile, order: entry.order, role: entry.role ?? "", intro: entry.intro ?? "", segments: structuredClone(draftFile.segments) };
      if (draft.mode === "learn") {
        try {
          if (draftFile.action !== "delete") file.segments = applyHoles(file, holesByPath.get(file.path) ?? [], reference);
        } catch (error) {
          errors.push(error.message);
        }
      } else {
        attachNotes(file, notes);
      }
      return file;
    });
    const auto = (s.autoApplied ?? []).map((p) => autoByPath.get(p)).filter(Boolean);
    if (si === 0) for (const a of draft.autoApplied) if (!assignedAuto.has(a.path)) auto.push(a);
    const { files: _f, autoApplied: _a, ...meta } = s;
    return { ...meta, files: files.filter(Boolean), autoApplied: auto.map((a) => ({ ...a, step: s.id })) };
  });

  if (errors.length) return { ok: false, errors };

  const { files: _files, autoApplied: _auto, ...head } = draft;
  const session = { ...head, title: plan.title || draft.task, steps };
  writeFileSync(join(dir, "session.json"), JSON.stringify(session, null, 2));
  if (draft.mode === "learn") {
    mkdirSync(join(dir, "private"), { recursive: true });
    writeFileSync(join(dir, "private", "reference.json"), JSON.stringify(reference, null, 2));
  }
  return { ok: true, errors: [] };
}

/** Attaches notes keyed by new line number (typed) or negative old line number (removed). */
function attachNotes(file, notes) {
  let newNo = 0;
  let oldNo = 0;
  for (const seg of file.segments) {
    for (const line of seg.lines ?? []) {
      if (seg.kind === "removed") {
        oldNo++;
        const note = notes.get(`${file.path}:-${oldNo}`);
        if (note) line.note = note;
      } else if (seg.kind === "typed") {
        newNo++;
        const note = notes.get(`${file.path}:${newNo}`);
        if (note) line.note = note;
      } else {
        newNo++;
        oldNo++;
      }
    }
  }
}

