/*
 * Level 3 for learn mode: the whole file in a real editor. Claude's lines (signatures, types, unchanged
 * code) are locked; the holes are yours to write. Each file is submitted and graded on its own.
 */

import { go } from "../app.js";
import { burst, confetti, sfx } from "../fx.js";
import { modeFor } from "../highlight.js";
import { Loom } from "../loom.js";
import { fileProgress, fileStatus, isApplied, latestGrade, refresh, saveProgress, stepNumber, stepOf, store } from "../store.js";
import { ApiError, api, esc, holesOf, md, modal, toast } from "../util.js";
import { resolveConflict } from "./file.js";
import { stepColor } from "./map.js";
import { finishFile } from "./step.js";

const REVEAL_AFTER = 3;
const VERDICT = { pass: ["Passed", "✓"], partial: ["Almost there", "~"], retry: ["Not yet", "↺"] };

let v = null;

export function render({ path }) {
  const step = stepOf(path);
  const file = step.files.find((f) => f.path === path);
  const fp = fileProgress(path);
  const holes = holesOf(file);
  const done = isApplied(path);
  const info = store.state.files[path];
  const readOnly = done || file.action === "delete" || !holes.length;
  // awaiting: the attempt we submitted and haven't seen graded yet, so its result is acted on exactly once
  v = { file, step, fp, holes, readOnly, done, cm: null, parts: [], widgets: [], commentWidgets: [], awaiting: null };

  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="play learn">
      <header class="hud glass">
        <button class="btn ghost small" data-back>← Step ${stepNumber(step)}</button>
        <div class="hud-title">
          <div><h2><code>${esc(file.path)}</code> ${file.action === "read" ? "" : `<span class="badge ${file.action === "create" ? "new" : file.action === "delete" ? "deleted" : "modified"}">${file.action === "create" ? "new" : file.action === "delete" ? "deleted" : "modified"}</span>`}</h2>
          <small id="attempts"></small></div>
        </div>
        ${
          readOnly
            ? ""
            : `<button class="btn ghost small" id="btn-hint" title="Ask Claude for a hint about the part your cursor is in">Ask for a hint</button>
               <button class="btn ghost small" id="btn-reveal" title="Unlocks after ${REVEAL_AFTER} graded attempts">Reveal this part</button>
               <button class="btn" id="btn-submit">Submit for grading</button>`
        }
      </header>
      <div class="workspace">
        <section class="editor glass">
          <div class="editor-bar"><span class="dots"><i></i><i></i><i></i></span><span>${esc(file.path)}</span><span class="spacer"></span>
            <span class="legend-inline"><i class="lg given"></i> Claude's (locked) <i class="lg hole"></i> yours to write <i class="lg removed"></i> removed</span></div>
          <div class="cm-host" id="cm"></div>
        </section>
        <aside class="side">
          <div class="note-card glass"><h4><span id="spec-label">What to write</span></h4><div class="note-text" id="spec"></div></div>
          <div class="grade-card glass" id="grade"></div>
          <div class="loom-card glass"><h4><span>Your weave</span><span id="loom-count"></span></h4><canvas id="loom"></canvas></div>
        </aside>
      </div>
    </div>`;

  app.querySelector("[data-back]").addEventListener("click", back);
  app.querySelector("#btn-submit")?.addEventListener("click", submit);
  app.querySelector("#btn-hint")?.addEventListener("click", hint);
  app.querySelector("#btn-reveal")?.addEventListener("click", reveal);

  buildEditor(info);
  v.loom = new Loom(document.getElementById("loom"), { total: Math.max(1, holes.length), filled: filledHoles(), color: stepColor(stepNumber(step) - 1) });
  renderSide();
  if (!readOnly) {
    v.cm.focus();
    const first = holeRange(0);
    if (first) v.cm.setCursor(first.from);
  }
  if (file.action === "delete" || (!holes.length && !done)) showApplyBar();
}

export function leave() {
  v?.loom?.destroy();
  v = null;
}

export function onState({ changedFiles }) {
  if (!v || !changedFiles.includes(v.file.path)) return;
  renderSide();
}

/* ---------- editor ---------- */

/** Builds the document: given lines locked, holes editable, removed lines shown as struck-through widgets. */
function buildEditor(info) {
  const { file, fp, readOnly } = v;
  const lines = [];
  const parts = [];
  const removedBlocks = [];
  let pendingRemoved = [];
  const latest = info?.latest?.holes ?? {};
  const textFor = (seg) => fp.draft?.[seg.id] ?? latest[seg.id] ?? seg.indent;

  for (const seg of file.segments) {
    if (seg.kind === "removed") {
      pendingRemoved.push(...seg.lines);
      continue;
    }
    if (pendingRemoved.length) {
      removedBlocks.push({ at: lines.length, lines: pendingRemoved });
      pendingRemoved = [];
    }
    if (seg.kind === "hole") {
      const text = textFor(seg).split("\n");
      parts.push({ type: "hole", id: seg.id, seg, from: lines.length, to: lines.length + text.length - 1 });
      lines.push(...text);
    } else {
      const last = parts.at(-1);
      const start = lines.length;
      lines.push(...seg.lines.map((l) => l.indent + l.text + (l.trail ?? "")));
      if (last?.type === "given") last.to = lines.length - 1;
      else parts.push({ type: "given", from: start, to: lines.length - 1, added: [] });
      seg.lines.forEach((l, i) => l.added && parts.at(-1).added.push(start + i));
    }
  }
  if (pendingRemoved.length) removedBlocks.push({ at: lines.length, lines: pendingRemoved });

  const host = document.getElementById("cm");
  const usesTabs = lines.some((l) => /^\t/.test(l));
  const cm = window.CodeMirror(host, {
    value: lines.join("\n"),
    mode: modeFor(file.language),
    theme: "lbl",
    lineNumbers: true,
    tabSize: file.tabSize ?? 2,
    indentUnit: file.tabSize ?? 2,
    indentWithTabs: usesTabs,
    readOnly: readOnly ? "nocursor" : false,
    viewportMargin: Infinity,
    extraKeys: { Tab: (c) => (c.somethingSelected() ? c.indentSelection("add") : c.replaceSelection(usesTabs ? "\t" : " ".repeat(c.getOption("indentUnit")))) },
  });
  v.cm = cm;
  const last = cm.lastLine();

  // Lock the given parts, including the newline on each side, so a hole can't swallow or split them.
  for (const part of parts) {
    if (part.type !== "given") continue;
    for (let l = part.from; l <= part.to; l++) cm.addLineClass(l, "wrap", part.added.includes(l) ? "lbl-given lbl-added" : "lbl-given");
    if (readOnly) continue;
    const from = part.from === 0 ? { line: 0, ch: 0 } : { line: part.from - 1, ch: cm.getLine(part.from - 1).length };
    const to = part.to === last ? { line: last, ch: cm.getLine(last).length } : { line: part.to + 1, ch: 0 };
    part.marker = cm.markText(from, to, { readOnly: true, inclusiveLeft: part.from === 0, inclusiveRight: part.to === last });
  }
  v.parts = parts;

  for (const block of removedBlocks) {
    const node = document.createElement("div");
    node.className = "lbl-removed";
    node.innerHTML = block.lines.map((l) => `<div>${esc(l.indent + l.text) || "&nbsp;"}</div>`).join("");
    const anchor = block.at === 0 ? 0 : block.at - 1;
    cm.addLineWidget(anchor, node, { above: block.at === 0 });
  }

  // A small label above each hole with its spec's first line.
  parts.forEach((part, i) => {
    if (part.type !== "hole") return;
    const node = document.createElement("div");
    node.className = "lbl-hole-label";
    node.innerHTML = `<b>✎ ${esc(part.id)}</b> ${esc((part.seg.spec ?? "").split("\n")[0].slice(0, 120))}`;
    node.addEventListener("click", () => {
      const r = holeRange(i);
      if (r) cm.setCursor(r.from);
      cm.focus();
    });
    const prev = parts[i - 1];
    if (prev) cm.addLineWidget(prev.to, node, { above: false });
    else cm.addLineWidget(0, node, { above: true });
  });

  markHoleLines();
  if (!readOnly) {
    let timer;
    cm.on("changes", () => {
      markHoleLines();
      clearTimeout(timer);
      timer = setTimeout(saveDraft, 500);
      v.loom.set(filledHoles());
      updateLoomCount();
    });
    cm.on("cursorActivity", showSpecAtCursor);
  }
  showSpecAtCursor();
  requestAnimationFrame(() => cm.refresh());
}

/** The current range of hole number `i` (index into v.parts). */
function holeRange(i) {
  const part = v.parts[i];
  if (!part || part.type !== "hole") {
    const idx = v.parts.findIndex((p, k) => k >= i && p.type === "hole");
    if (idx === -1) return null;
    return holeRange(idx);
  }
  const { cm } = v;
  if (v.readOnly) return { from: { line: part.from, ch: 0 }, to: { line: part.to, ch: cm.getLine(part.to).length } };
  const prev = v.parts[i - 1]?.marker?.find();
  const next = v.parts[i + 1]?.marker?.find();
  const from = prev ? prev.to : { line: 0, ch: 0 };
  const to = next ? next.from : { line: cm.lastLine(), ch: cm.getLine(cm.lastLine()).length };
  return { from, to };
}

const holeIndexes = () => v.parts.map((p, i) => (p.type === "hole" ? i : -1)).filter((i) => i !== -1);

function holeTexts() {
  const out = {};
  for (const i of holeIndexes()) {
    const r = holeRange(i);
    out[v.parts[i].id] = v.cm.getRange(r.from, r.to);
  }
  return out;
}

function filledHoles() {
  if (!v?.cm) return 0;
  if (v.done) return v.holes.length;
  return Object.entries(holeTexts()).filter(([id, t]) => t.trim() && t !== v.holes.find((h) => h.id === id)?.indent).length;
}

function markHoleLines() {
  const { cm } = v;
  cm.eachLine((line) => cm.removeLineClass(line, "wrap", "lbl-hole"));
  for (const i of holeIndexes()) {
    const r = holeRange(i);
    for (let l = r.from.line; l <= r.to.line; l++) cm.addLineClass(l, "wrap", "lbl-hole");
  }
}

function holeAtCursor() {
  const cur = v.cm.getCursor();
  for (const i of holeIndexes()) {
    const r = holeRange(i);
    if (cur.line >= r.from.line && cur.line <= r.to.line) return v.parts[i];
  }
  return null;
}

function showSpecAtCursor() {
  const part = !v.readOnly ? holeAtCursor() : null;
  const el = document.getElementById("spec");
  const label = document.getElementById("spec-label");
  if (!el) return;
  if (part) {
    label.textContent = `What to write · ${part.id}`;
    const hints = (store.state.files[v.file.path]?.hints ?? []).filter((h) => h.holeId === part.id);
    el.innerHTML = md(part.seg.spec) + hints.map((h) => `<div class="hint"><b>Hint</b>${md(h.text)}</div>`).join("");
  } else {
    label.textContent = v.readOnly ? v.file.path : "What to write";
    el.innerHTML = v.readOnly
      ? md(v.done ? "This file is written to your project. It's read-only here." : v.file.intro || v.file.role || "")
      : md(`${v.file.intro || v.file.role || ""}\n\nPut your cursor inside a highlighted part to see what it should do. The dimmed lines are Claude's and are locked.`);
  }
}

function saveDraft() {
  if (!v || v.readOnly) return;
  v.fp.draft = holeTexts();
  saveProgress();
}

/* ---------- side panel: attempts and grades ---------- */

function updateLoomCount() {
  const el = document.getElementById("loom-count");
  if (el) el.textContent = `${filledHoles()} / ${v.holes.length} parts`;
}

function renderSide() {
  if (!v) return;
  const path = v.file.path;
  const info = store.state.files[path];
  const status = fileStatus(v.file);
  const grade = latestGrade(path);
  const failed = (info?.grades ?? []).filter((g) => g.verdict !== "pass").length;
  const el = document.getElementById("grade");
  document.getElementById("attempts").textContent = info?.submissions ? `Attempt ${info.submissions}${status === "grading" ? " · grading…" : ""}` : "Not submitted yet";
  updateLoomCount();
  const reveal = document.getElementById("btn-reveal");
  if (reveal) {
    reveal.disabled = failed < REVEAL_AFTER;
    reveal.title = failed < REVEAL_AFTER ? `Unlocks after ${REVEAL_AFTER} graded attempts (${failed} so far)` : "Show Claude's version of the part your cursor is in";
  }
  const submitBtn = document.getElementById("btn-submit");
  if (submitBtn) submitBtn.disabled = status === "grading";

  if (status === "grading") {
    el.innerHTML = `<h4><span>Grade</span></h4><div class="waiting"><div class="spinner"></div><div>Claude is checking attempt ${info.submissions}: running the project's checks and reading your code. The result appears here.</div></div>`;
    return;
  }
  if (!grade) {
    el.innerHTML = `<h4><span>Grade</span></h4><p class="dim">${v.readOnly ? "Nothing to grade in this file." : "Write every highlighted part, then submit. Claude runs the project's checks against your code and reviews it."}</p>`;
    return;
  }
  const [title, icon] = VERDICT[grade.verdict] ?? ["Graded", "•"];
  el.innerHTML = `
    <h4><span>Grade · attempt ${grade.attempt}</span>${typeof grade.score === "number" ? `<span>${grade.score}/100</span>` : ""}</h4>
    <div class="verdict ${esc(grade.verdict)}"><div class="badge-icon">${icon}</div><div><h3>${title}</h3><div class="feedback">${md(grade.feedback ?? "")}</div></div></div>
    ${
      v.done
        ? `<p class="dim">Written to your project.</p>`
        : grade.verdict === "partial"
          ? `<div class="row-actions"><button class="btn small" id="btn-accept">Accept and write it</button><button class="btn ghost small" id="btn-improve">Keep improving</button></div>`
          : grade.verdict === "pass"
            ? `<div class="row-actions"><button class="btn small" id="btn-accept">Write it to the project</button></div>`
            : ""
    }`;
  el.querySelector("#btn-accept")?.addEventListener("click", apply);
  el.querySelector("#btn-improve")?.addEventListener("click", () => v.cm.focus());
  showComments(grade);

  if (v.awaiting === grade.attempt) {
    v.awaiting = null;
    if (grade.verdict === "pass") {
      sfx.win();
      confetti(90);
      apply();
    } else {
      sfx.error();
      toast(`${esc(v.file.path)}: ${title.toLowerCase()}`, icon);
    }
  }
}

function showComments(grade) {
  for (const w of v.commentWidgets) w.clear();
  v.commentWidgets = [];
  for (const c of grade.comments ?? []) {
    const line = Math.max(0, Math.min(v.cm.lastLine(), Number(c.line) - 1));
    const node = document.createElement("div");
    node.className = `lbl-comment ${esc(grade.verdict)}`;
    node.innerHTML = `<b>Claude</b> ${md(c.text)}`;
    v.commentWidgets.push(v.cm.addLineWidget(line, node, { above: false }));
  }
}

/* ---------- actions ---------- */

async function submit() {
  saveDraft();
  const holes = holeTexts();
  const empty = v.holes.filter((h) => !holes[h.id]?.trim());
  const send = async () => {
    try {
      const { attempt } = await api.post("/api/submit", { path: v.file.path, holes });
      v.awaiting = attempt;
      toast(`Attempt ${attempt} submitted. Claude is grading it.`, "…");
      await refresh();
      renderSide();
    } catch (error) {
      toast(esc(error.message), "!");
    }
  };
  if (empty.length) {
    modal(
      `<h2>Submit with ${empty.length} empty part${empty.length > 1 ? "s" : ""}?</h2><p class="dim">${empty.map((h) => `<code>${esc(h.id)}</code>`).join(", ")} ${empty.length > 1 ? "are" : "is"} still empty.</p>
       <div class="modal-actions"><button class="btn ghost" data-act="close">Keep writing</button><button class="btn" data-act="go">Submit anyway</button></div>`,
      { go: send },
    );
  } else send();
}

async function apply() {
  const path = v.file.path;
  try {
    await api.post("/api/apply", { path });
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 409)) return toast(`Couldn't write <code>${esc(path)}</code>: ${esc(error.message)}`, "!");
    if (!(await resolveConflict(path, () => api.post("/api/apply", { path, force: true })))) return;
  }
  delete v.fp.draft;
  v.fp.done = true;
  await saveProgress(true);
  await refresh();
  toast(`Wrote <code>${esc(path)}</code>`, "✓");
  burst(innerWidth / 2, innerHeight / 2, { count: 50, power: 1.6 });
  setTimeout(() => {
    if (v?.file.path === path) finishFile(path);
  }, 800);
}

async function hint() {
  const part = holeAtCursor() ?? v.parts.find((p) => p.type === "hole");
  try {
    await api.post("/api/hint", { path: v.file.path, holeId: part.id });
    toast(`Asked Claude for a hint about <code>${esc(part.id)}</code>. It appears under the spec.`, "?");
  } catch (error) {
    toast(esc(error.message), "!");
  }
}

function reveal() {
  const part = holeAtCursor() ?? v.parts.find((p) => p.type === "hole");
  modal(
    `<h2>Reveal Claude's version of <code>${esc(part.id)}</code>?</h2><p class="dim">It replaces what you wrote in that part. Reveals are noted in your results.</p>
     <div class="modal-actions"><button class="btn ghost" data-act="close">Not yet</button><button class="btn" data-act="go">Reveal it</button></div>`,
    {
      go: async () => {
        try {
          const { text } = await api.post("/api/reveal", { path: v.file.path, holeId: part.id });
          const i = v.parts.indexOf(part);
          const r = holeRange(i);
          v.cm.replaceRange(text, r.from, r.to);
          toast(`Revealed <code>${esc(part.id)}</code>. Read it, then submit again.`, "👁");
        } catch (error) {
          toast(esc(error.message), "!");
        }
      },
    },
  );
}

/** Deleted files and files with nothing to write just need a confirmation. */
function showApplyBar() {
  const del = v.file.action === "delete";
  const bar = document.createElement("div");
  bar.className = "apply-bar";
  bar.innerHTML = `<span>${del ? "This file is deleted in this step." : "Nothing to write here: read it, then add it to your project."}</span><button class="btn small" id="apply-now">${del ? "Delete the file" : "Write it to the project"}</button>`;
  document.querySelector(".editor").append(bar);
  bar.querySelector("#apply-now").addEventListener("click", apply);
}

function back() {
  saveDraft();
  go("step", { stepId: v.step.id });
}

addEventListener("keydown", (e) => {
  if (e.key === "Escape" && v && !document.querySelector(".overlay")) back();
});
