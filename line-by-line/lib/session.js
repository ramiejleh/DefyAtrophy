import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const MODES = ["type", "learn", "review"];
export const CAPS = { type: 600, learn: 40, review: 2500 };

export const sha256 = (content) => createHash("sha256").update(content).digest("hex");

/**
 * Splits file content into lines, keeping what's needed to rebuild it byte for byte.
 * Each line is { indent, text, trail }: leading whitespace (tabs kept), the part the user types,
 * and trailing whitespace. Only `text` is ever typed; the rest is filled in automatically.
 * @param {string} content
 */
export function splitContent(content) {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const mixed = eol === "\r\n" && /(^|[^\r])\n/.test(content);
  if (content === "") return { eol, finalNewline: false, mixed: false, lines: [] };
  const finalNewline = content.endsWith(eol);
  const body = finalNewline ? content.slice(0, -eol.length) : content;
  return { eol, finalNewline, mixed, lines: body.split(eol).map(parseLine) };
}

/** @param {string} raw */
export function parseLine(raw) {
  const indent = raw.match(/^[ \t]*/)[0];
  const rest = raw.slice(indent.length);
  const text = rest.replace(/[ \t]+$/, "");
  return { indent, text, trail: rest.slice(text.length) };
}

export const lineString = (l) => l.indent + l.text + (l.trail ?? "");

/**
 * Rebuilds a file's content from its segments. `holeText(id)` supplies the text of learn-mode holes
 * (the user's submission, or the reference solution when validating).
 */
export function rebuild(file, holeText = () => "") {
  const out = [];
  for (const seg of file.segments) {
    if (seg.kind === "given" || seg.kind === "typed") out.push(...seg.lines.map(lineString));
    if (seg.kind === "hole") out.push(...String(holeText(seg.id) ?? "").replace(/\r\n/g, "\n").split("\n"));
  }
  if (!out.length) return "";
  return out.join(file.eol) + (file.finalNewline ? file.eol : "");
}

/** Every line of a file in display order, tagged with its kind and line numbers. */
export function rows(file) {
  const result = [];
  let newNo = 0;
  let oldNo = 0;
  for (const seg of file.segments) {
    if (seg.kind === "hole") {
      result.push({ kind: "hole", id: seg.id, newNo: newNo + 1 });
      newNo++;
      continue;
    }
    for (const line of seg.lines) {
      if (seg.kind === "removed") result.push({ kind: "removed", ...line, oldNo: ++oldNo });
      else if (seg.kind === "typed") result.push({ kind: "typed", ...line, newNo: ++newNo });
      else {
        oldNo++;
        result.push({ kind: "given", ...line, newNo: ++newNo });
      }
    }
  }
  return result;
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function loadSession(dir) {
  const file = join(dir, "session.json");
  if (!existsSync(file)) throw new Error(`No session.json in ${dir}`);
  return JSON.parse(readFileSync(file, "utf8"));
}

export const allFiles = (session) => session.steps.flatMap((s) => s.files.map((f) => ({ step: s, file: f })));

export function findFile(session, path) {
  for (const step of session.steps) {
    const file = step.files.find((f) => f.path === path);
    if (file) return { step, file };
  }
  return undefined;
}

/** Lines the user steps through (review) or types (type): non-blank typed lines, plus removed lines in review. */
export function stepLines(file, mode) {
  return rows(file).filter((r) => (r.kind === "typed" && r.text !== "") || (mode === "review" && r.kind === "removed" && r.text !== ""));
}
