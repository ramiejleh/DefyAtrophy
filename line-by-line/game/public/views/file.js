/*
 * Level 3 for type and review mode: the whole file, scrollable, with the lines you type (or step
 * through) marked. Also the read-only view of a finished file.
 */

import { go } from "../app.js";
import { burst, floatText, sfx, sound } from "../fx.js";
import { highlightLines, spans } from "../highlight.js";
import { Loom } from "../loom.js";
import { computeStats, emptyStats, fileProgress, isApplied, mode, refresh, saveProgress, stepNumber, stepOf, store } from "../store.js";
import { ApiError, api, esc, md, mdInline, modal, rowsOf, stopsOf, toast } from "../util.js";
import { stepColor } from "./map.js";
import { finishFile } from "./step.js";

/** Gaps between keystrokes longer than this don't count as typing time (ms) */
const IDLE_CAP_MS = 4000;
/** Wrong characters allowed before further input is ignored */
const MAX_WRONG = 8;
const SMART_CHARS = { "‘": "'", "’": "'", "“": '"', "”": '"', " ": " " };

/** The open file. null when another screen is showing. */
let v = null;
const $keys = document.getElementById("keys");

export function render({ path, read = false }) {
  const step = stepOf(path);
  const file = step.files.find((f) => f.path === path);
  const fp = fileProgress(path);
  const rows = rowsOf(file);
  const stops = stopsOf(file, mode());
  const finished = mode() === "review" ? fp.done : isApplied(path) || fp.done;
  const kind = read || finished ? "read" : stops.length === 0 ? "apply" : mode() === "review" ? "review" : "type";
  fp.cursor = Math.min(fp.cursor ?? 0, stops.length);
  v = { file, step, fp, rows, stops, kind, typed: "", wrong: "", lineErrors: 0, assisted: false, combo: 0, lastKey: 0, lastNote: null, selected: null };
  v.classes = classify(file, rows);

  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="play">
      <header class="hud glass">
        <button class="btn ghost small" data-back title="Back to the step (Esc)">← Step ${stepNumber(step)}</button>
        <div class="hud-title">
          <div><h2><code>${esc(file.path)}</code> <span class="badge ${file.action === "create" ? "new" : file.action === "delete" ? "deleted" : "modified"}">${file.action === "create" ? "new" : file.action === "delete" ? "deleted" : "modified"}</span></h2>
          <small id="file-pos"></small></div>
        </div>
        ${hudStats(kind)}
        ${hudButtons(kind)}
      </header>
      <div class="workspace">
        <section class="editor glass">
          <div class="editor-bar"><span class="dots"><i></i><i></i><i></i></span><span>${esc(file.path)}</span><span class="spacer"></span><span class="legend-inline">${legend(kind)}</span></div>
          <div class="code-wrap">
            <div class="code ${kind}" id="code" style="tab-size:${file.tabSize ?? 2}" role="region" aria-label="File contents">${rows.map((r, k) => rowHtml(r, k)).join("")}</div>
            <div class="minimap" id="minimap" aria-hidden="true"></div>
            <button class="to-cursor" id="to-cursor" hidden>↓ Back to the cursor</button>
          </div>
        </section>
        <aside class="side">
          <div class="note-card glass"><h4><span id="note-label">What this line does</span></h4><div class="note-text" id="note" aria-live="polite"></div></div>
          <div class="history glass"><h4><span>Notes in this file</span></h4><ol id="history"></ol></div>
          <div class="loom-card glass"><h4><span>Your weave</span><span id="loom-count"></span></h4><canvas id="loom"></canvas></div>
        </aside>
      </div>
    </div>`;

  wireHud(app);
  renderMinimap();
  const code = document.getElementById("code");
  code.addEventListener("scroll", updateCursorPill, { passive: true });
  document.getElementById("to-cursor").addEventListener("click", () => {
    scrollToCurrent(true);
    focusKeys();
  });
  code.addEventListener("click", (e) => {
    const row = e.target.closest(".row");
    if (row && (v.kind === "read" || v.kind === "review" || v.kind === "apply")) showRowNote(Number(row.dataset.k));
    focusKeys();
  });

  v.loom = new Loom(document.getElementById("loom"), { total: stops.length, filled: kind === "read" ? stops.length : fp.cursor, color: stepColor(stepNumber(step) - 1) });
  rebuildHistory();
  if (kind === "type" || kind === "review") renderCurrent(true);
  else {
    setNote(null);
    updatePos();
    if (kind === "apply") showApplyPrompt();
  }
  focusKeys();
}

export function leave() {
  v?.loom?.destroy();
  v = null;
  document.querySelector(".focus-veil")?.remove();
  $keys.blur();
}

/* ---------- rendering ---------- */

/** Highlights the new file and the removed lines as two documents, then maps classes back to rows. */
function classify(file, rows) {
  const newIdx = [];
  const oldIdx = [];
  rows.forEach((r, k) => (r.kind === "removed" ? oldIdx : newIdx).push(k));
  const line = (r) => (r.indent ?? "") + (r.text ?? "");
  const newCls = highlightLines(newIdx.map((k) => line(rows[k])), file.language);
  const oldCls = highlightLines(oldIdx.map((k) => line(rows[k])), file.language);
  const out = new Array(rows.length);
  newIdx.forEach((k, i) => (out[k] = newCls[i]));
  oldIdx.forEach((k, i) => (out[k] = oldCls[i]));
  return out;
}

const curStopRow = () => v.stops[v.fp.cursor];

function rowState(r, k) {
  if (r.kind === "given") return "given";
  const at = v.stops.indexOf(k);
  if (v.kind === "read" || v.kind === "apply") return r.kind;
  if (v.kind === "review") {
    if (at === -1) return `${r.kind} plain`;
    return `${r.kind} ${at < v.fp.cursor ? "seen" : at === v.fp.cursor ? "current" : "ahead"}`;
  }
  if (r.kind === "removed") return "removed";
  // type mode: typed rows before the cursor are done; blank typed rows count as done once passed
  const cur = curStopRow() ?? Infinity;
  if (k < cur) return "typed done";
  if (k === cur) return "typed current";
  return "typed pending";
}

function lineNo(r) {
  if (r.kind === "removed") return "−";
  return r.newNo ?? "";
}

function srcHtml(r, k) {
  const cls = v.classes[k] ?? [];
  const full = `${esc(r.indent)}${spans(r.text, cls, r.indent.length)}`;
  if (r.kind === "typed" && v.kind === "type") {
    const state = rowState(r, k);
    if (state.includes("pending")) return r.text ? `${esc(r.indent)}<i class="skel" style="width:${Math.min(r.text.length, 90)}ch"></i>` : "";
  }
  return full;
}

function rowHtml(r, k) {
  const state = rowState(r, k);
  return `<div class="row ${state}" data-k="${k}" id="r${k}"><span class="ln">${lineNo(r)}</span><span class="mark"></span><span class="src">${srcHtml(r, k)}</span></div>`;
}

function refreshRow(k) {
  const el = document.getElementById(`r${k}`);
  if (el) el.outerHTML = rowHtml(v.rows[k], k);
}

function renderCurrent(isNew = false) {
  const k = curStopRow();
  if (k === undefined) return;
  const r = v.rows[k];
  let el = document.getElementById(`r${k}`);
  if (isNew) {
    if (v.kind === "type") {
      // rows between the previous stop and this one (blank typed lines) are done now too
      for (let j = (v.stops[v.fp.cursor - 1] ?? -1) + 1; j <= k; j++) refreshRow(j);
    } else refreshRow(k);
    el = document.getElementById(`r${k}`);
    setNote(r, k);
    updatePos();
    scrollToCurrent();
    renderMinimap();
  }
  if (v.kind !== "type") return;
  const cls = v.classes[k] ?? [];
  const ready = !v.wrong && v.typed === r.text;
  const typed = spans(v.typed, cls, r.indent.length);
  const wrong = [...v.wrong].map((c) => `<span class="wrong">${c === " " ? "·" : esc(c)}</span>`).join("");
  const ghost = store.progress.blind ? "" : esc(r.text.slice(v.typed.length + v.wrong.length));
  el.classList.toggle("ready", ready);
  el.querySelector(".src").innerHTML = `${esc(r.indent)}${typed}${wrong}<span class="caret"></span><span class="ghost">${ghost}</span>${
    ready ? `<span class="enter-hint">press Enter ⏎</span>` : ""
  }`;
}

function rowVisible(k) {
  const code = document.getElementById("code");
  const el = document.getElementById(`r${k}`);
  if (!code || !el) return true;
  const top = el.offsetTop - code.scrollTop;
  return top > 0 && top < code.clientHeight - el.offsetHeight;
}

function scrollToCurrent(force = false) {
  const code = document.getElementById("code");
  const k = curStopRow();
  const el = document.getElementById(`r${k}`);
  if (!code || !el) return;
  if (force || !rowVisible(k) || el.offsetTop - code.scrollTop > code.clientHeight * 0.7) {
    code.scrollTop = Math.max(0, el.offsetTop - code.clientHeight * 0.4);
  }
  updateCursorPill();
}

function updateCursorPill() {
  const pill = document.getElementById("to-cursor");
  if (!pill || !v) return;
  const k = curStopRow();
  pill.hidden = !(v.kind === "type" || v.kind === "review") || k === undefined || rowVisible(k);
  if (!pill.hidden) {
    const el = document.getElementById(`r${k}`);
    pill.textContent = el.offsetTop < document.getElementById("code").scrollTop ? "↑ Back to the cursor" : "↓ Back to the cursor";
  }
}

/** A strip down the editor's edge marking where the typed (or changed) lines are. */
function renderMinimap() {
  const mm = document.getElementById("minimap");
  if (!mm) return;
  const code = document.getElementById("code");
  // Only worth showing when the file doesn't fit on screen.
  mm.hidden = code.scrollHeight - code.clientHeight * 0.4 <= code.clientHeight;
  if (mm.hidden) return;
  const n = v.rows.length || 1;
  let html = "";
  let start = -1;
  for (let k = 0; k <= v.rows.length; k++) {
    const r = v.rows[k];
    const changed = r && (r.kind === "typed" || r.kind === "removed");
    if (changed && start === -1) start = k;
    if (!changed && start !== -1) {
      const kind = v.rows[start].kind;
      html += `<i class="${kind}" style="top:${(start / n) * 100}%;height:max(3px, ${((k - start) / n) * 100}%)"></i>`;
      start = -1;
    }
  }
  const k = curStopRow();
  if (k !== undefined && (v.kind === "type" || v.kind === "review")) html += `<b style="top:${(k / n) * 100}%"></b>`;
  mm.innerHTML = html;
  mm.onclick = (e) => {
    const code = document.getElementById("code");
    const frac = (e.clientY - mm.getBoundingClientRect().top) / mm.clientHeight;
    code.scrollTop = frac * code.scrollHeight - code.clientHeight / 2;
  };
}

function setNote(r) {
  const el = document.getElementById("note");
  const label = document.getElementById("note-label");
  if (!el) return;
  const fresh = el.cloneNode(false);
  if (r?.note) {
    label.textContent = r.kind === "removed" ? `Removed line` : `Line ${r.newNo}`;
    fresh.innerHTML = md(r.note);
    v.lastNote = r.note;
  } else if (r && v.lastNote) {
    label.textContent = "Previous note";
    fresh.classList.add("stale");
    fresh.innerHTML = md(v.lastNote);
  } else {
    label.textContent = v.file.path;
    fresh.innerHTML = md(v.file.intro || v.file.role || (v.kind === "read" ? "Click any marked line to see its note." : "Let's go."));
  }
  el.replaceWith(fresh);
}

function showRowNote(k) {
  const r = v.rows[k];
  if (!r || r.kind === "given") return;
  document.querySelectorAll(".row.selected").forEach((el) => el.classList.remove("selected"));
  document.getElementById(`r${k}`)?.classList.add("selected");
  v.lastNote = null;
  setNote(r, k);
}

function rebuildHistory() {
  const list = document.getElementById("history");
  if (!list) return;
  list.innerHTML = "";
  const upto = v.kind === "read" || v.kind === "apply" ? v.stops.length : v.fp.cursor;
  for (let i = 0; i < upto; i++) {
    const r = v.rows[v.stops[i]];
    if (r.note) addHistory(r, false);
  }
  for (let i = v.fp.cursor - 1; i >= 0 && v.kind !== "read"; i--) {
    if (v.rows[v.stops[i]].note) {
      v.lastNote = v.rows[v.stops[i]].note;
      break;
    }
  }
}

function addHistory(r, animate = true) {
  const li = document.createElement("li");
  li.innerHTML = `<b>${r.kind === "removed" ? "−" : r.newNo}</b><span>${mdInline(r.note)}</span>`;
  if (!animate) li.style.animation = "none";
  document.getElementById("history")?.prepend(li);
}

function updatePos() {
  const total = v.stops.length;
  const at = Math.min(v.fp.cursor, total);
  const el = document.getElementById("file-pos");
  if (el) {
    el.textContent =
      v.kind === "read"
        ? "Read mode: nothing to type here"
        : v.kind === "apply"
          ? "Nothing to type in this file"
          : v.kind === "review"
            ? `Changed line ${Math.min(at + 1, total)} of ${total}`
            : `${at} of ${total} lines typed`;
  }
  const lc = document.getElementById("loom-count");
  if (lc) lc.textContent = `${v.kind === "read" ? total : at} / ${total}`;
}

/* ---------- HUD ---------- */

function hudStats(kind) {
  if (kind !== "type") return "";
  return `<div class="stats">
    <div class="stat"><b id="s-wpm">0</b><span>WPM</span></div>
    <div class="stat"><b id="s-acc">100%</b><span>Accuracy</span></div>
    <div class="stat combo"><b id="s-combo">0</b><span>Combo</span></div>
    <div class="stat" id="xp-stat"><b id="s-xp">0</b><span>XP</span></div>
  </div>`;
}

function hudButtons(kind) {
  const soundBtn = `<button class="icon-btn" id="btn-sound" title="Sound" aria-label="Toggle sound">${sound.enabled ? "🔊" : "🔈"}</button>`;
  if (kind === "type") {
    return `<button class="icon-btn" id="btn-autocomplete" title="Autocomplete this line (Tab)" aria-label="Autocomplete this line">⇥</button>
      <button class="icon-btn" id="btn-blind" title="Hide hints (Shift+Tab)" aria-label="Toggle blind mode">${store.progress.blind ? "🙈" : "👁"}</button>
      ${soundBtn}
      <button class="icon-btn" id="btn-pause" title="Pause (Esc)" aria-label="Pause">⏸</button>`;
  }
  if (kind === "review") {
    return `<button class="icon-btn" id="btn-prev" title="Previous changed line (↑)" aria-label="Previous changed line">↑</button>
      <button class="icon-btn" id="btn-next" title="Next changed line (↓, Tab or Enter)" aria-label="Next changed line">↓</button>`;
  }
  if (kind === "read") {
    return mode() === "review"
      ? `<button class="btn ghost small" id="btn-again">Step through again</button>`
      : mode() === "type" && v.stops.length
        ? `<button class="btn ghost small" id="btn-again">Type it again</button>`
        : "";
  }
  return "";
}

function legend(kind) {
  if (kind === "review") return `<i class="lg typed"></i> added <i class="lg removed"></i> removed · <kbd>↓</kbd> next <kbd>↑</kbd> back`;
  if (kind === "type") return `<i class="lg typed"></i> you type <i class="lg removed"></i> removed · <kbd>Tab</kbd> autocomplete · <kbd>⇧</kbd><kbd>Tab</kbd> blind`;
  return `<i class="lg typed"></i> ${mode() === "review" ? "added" : "typed"} <i class="lg removed"></i> removed`;
}

function wireHud(app) {
  app.querySelector("[data-back]").addEventListener("click", backToStep);
  app.querySelector("#btn-pause")?.addEventListener("click", pause);
  app.querySelector("#btn-autocomplete")?.addEventListener("click", () => {
    autocomplete();
    focusKeys();
  });
  app.querySelector("#btn-blind")?.addEventListener("click", () => {
    toggleBlind();
    focusKeys();
  });
  app.querySelector("#btn-sound")?.addEventListener("click", (e) => {
    sound.enabled = !sound.enabled;
    store.progress.sound = sound.enabled;
    e.currentTarget.textContent = sound.enabled ? "🔊" : "🔈";
    saveProgress();
    focusKeys();
  });
  app.querySelector("#btn-prev")?.addEventListener("click", () => move(-1));
  app.querySelector("#btn-next")?.addEventListener("click", () => move(1));
  app.querySelector("#btn-again")?.addEventListener("click", () => {
    v.fp.cursor = 0;
    v.fp.done = false;
    if (mode() === "type") v.fp.stats = emptyStats();
    saveProgress(true);
    render({ path: v.file.path });
  });
  if (v.kind === "type") updateHud();
}

function updateHud(pulseXp = false) {
  const s = v.fp.stats;
  const { wpm, accuracy } = computeStats(s);
  document.getElementById("s-wpm").textContent = wpm;
  document.getElementById("s-acc").textContent = `${accuracy}%`;
  document.getElementById("s-combo").textContent = v.combo;
  document.getElementById("s-xp").textContent = s.xp;
  if (pulseXp) {
    const stat = document.getElementById("xp-stat");
    stat.classList.remove("pulse");
    void stat.offsetWidth;
    stat.classList.add("pulse");
  }
}

function backToStep() {
  saveProgress(true);
  go("step", { stepId: v.step.id });
}

function pause() {
  if (!v || document.querySelector(".overlay")) return;
  modal(
    `<h2>Paused</h2><p class="dim">Your progress is saved after every line.</p>
     <div class="modal-actions center"><button class="btn ghost" data-act="step">Back to the step</button><button class="btn" data-act="resume" autofocus>Resume</button></div>`,
    { step: () => backToStep(), resume: () => {} },
    { className: "narrow center", onClose: focusKeys },
  );
}

/* ---------- typing ---------- */

function caretPoint() {
  const r = document.querySelector(".row.current .caret, .row.current .src")?.getBoundingClientRect();
  return r ? { x: r.left, y: r.top + r.height / 2 } : { x: innerWidth / 2, y: innerHeight / 2 };
}

function trackTime() {
  const now = performance.now();
  if (v.lastKey && now - v.lastKey < IDLE_CAP_MS) v.fp.stats.activeMs += now - v.lastKey;
  v.lastKey = now;
  const code = document.getElementById("code");
  code?.classList.add("typing");
  clearTimeout(v.typingTimer);
  v.typingTimer = setTimeout(() => code?.classList.remove("typing"), 600);
}

function shakeCurrent() {
  const el = document.getElementById(`r${curStopRow()}`);
  if (!el) return;
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
}

function handleChar(ch) {
  if (v?.kind !== "type" || document.querySelector(".overlay")) return;
  const target = v.rows[curStopRow()].text;
  trackTime();
  if (!rowVisible(curStopRow())) scrollToCurrent(true);
  if (!v.wrong && ch === target[v.typed.length]) {
    v.typed += ch;
    v.fp.stats.correct++;
    sfx.key();
  } else {
    if (v.wrong.length >= MAX_WRONG) return;
    v.wrong += ch;
    v.fp.stats.errors++;
    v.lineErrors++;
    v.combo = 0;
    sfx.error();
    shakeCurrent();
  }
  renderCurrent();
  updateHud();
}

function handleBackspace(word) {
  if (v?.kind !== "type") return;
  if (v.wrong) v.wrong = word ? "" : v.wrong.slice(0, -1);
  else if (word) v.typed = v.typed.replace(/(\s*[\w$]+|\s*[^\w$\s]+|\s+)$/, "");
  else v.typed = v.typed.slice(0, -1);
  renderCurrent();
}

function autocomplete() {
  if (v?.kind !== "type" || document.querySelector(".overlay")) return;
  const target = v.rows[curStopRow()].text;
  if (!v.wrong && v.typed === target) return;
  v.wrong = "";
  v.typed = target;
  v.assisted = true;
  renderCurrent();
}

function toggleBlind() {
  if (v?.kind !== "type") return;
  store.progress.blind = !store.progress.blind;
  const btn = document.getElementById("btn-blind");
  if (btn) btn.textContent = store.progress.blind ? "🙈" : "👁";
  toast(store.progress.blind ? "Blind mode on: no ghost text, typos still show" : "Hints back on", store.progress.blind ? "🙈" : "👁");
  saveProgress();
  renderCurrent();
}

function handleEnter() {
  if (v?.kind !== "type") return;
  const r = v.rows[curStopRow()];
  if (v.wrong || v.typed !== r.text) return shakeCurrent();
  completeLine();
}

function completeLine() {
  const { fp } = v;
  const k = curStopRow();
  const r = v.rows[k];
  const clean = v.lineErrors === 0;
  const point = caretPoint();
  const s = fp.stats;

  s.lines++;
  if (v.assisted) {
    s.assisted = (s.assisted ?? 0) + 1;
    floatText(point.x, point.y - 20, "autocompleted · 0 XP", "#8b94b4");
    sfx.line(0);
  } else {
    if (clean) {
      s.cleanLines++;
      v.combo++;
    } else v.combo = 0;
    s.bestCombo = Math.max(s.bestCombo, v.combo);
    const multiplier = v.combo >= 10 ? 3 : v.combo >= 5 ? 2 : 1;
    const gained = (2 + Math.ceil(r.text.length / 8)) * (clean ? multiplier : 1);
    s.xp += gained;
    store.progress.xp += gained;
    floatText(point.x, point.y - 20, `+${gained} XP${multiplier > 1 && clean ? ` ×${multiplier}` : ""}`, clean ? "#2ec4b6" : "#8b94b4");
    burst(point.x, point.y, { count: clean ? 10 + Math.min(v.combo, 20) : 6, power: clean ? 1 + v.combo * 0.03 : 0.6 });
    sfx.line(v.combo);
    if (clean && v.combo > 0 && v.combo % 5 === 0) comboFlash(v.combo);
  }

  if (r.note) addHistory(r);
  v.typed = "";
  v.wrong = "";
  v.lineErrors = 0;
  v.assisted = false;
  fp.cursor++;
  refreshRow(k);
  document.getElementById(`r${k}`)?.classList.add("fresh");
  v.loom.set(fp.cursor);
  saveProgress();
  updateHud(true);
  if (fp.cursor >= v.stops.length) return completeFile();
  renderCurrent(true);
}

function comboFlash(combo) {
  const el = document.createElement("div");
  el.className = "combo-flash";
  el.textContent = combo >= 10 ? `${combo} clean lines! ×3 XP` : `${combo} clean lines! ×2 XP`;
  document.querySelector(".editor").append(el);
  el.addEventListener("animationend", () => el.remove());
}

/** Writes the finished file, asking first if it changed on disk. */
async function writeFile(force = false) {
  const path = v.file.path;
  try {
    await api.post("/api/file", { path, force });
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) return resolveConflict(path, () => api.post("/api/file", { path, force: true }));
    toast(`Couldn't write <code>${esc(path)}</code>: ${esc(error.message)}`, "!");
    return false;
  }
}

/** The 409 dialog: overwrite, keep what's on disk, or look at both first. */
export function resolveConflict(path, overwrite) {
  return new Promise((done) => {
    const show = () =>
      modal(
        `<h2>${esc(path)} changed on disk</h2>
         <p class="dim">Someone (maybe you) edited this file after the session was built. What should happen to it?</p>
         <div class="modal-actions">
           <button class="btn ghost" data-act="diff">Show both</button>
           <button class="btn ghost" data-act="skip">Keep what's on disk</button>
           <button class="btn" data-act="overwrite">Overwrite with the new version</button>
         </div>`,
        {
          overwrite: async () => {
            try {
              await overwrite();
              done(true);
            } catch (error) {
              toast(esc(error.message), "!");
              done(false);
            }
          },
          skip: async () => {
            await api.post("/api/skip", { path });
            toast(`Kept your version of <code>${esc(path)}</code>`, "✓");
            done(true);
          },
          diff: async () => {
            const { content } = await api.get(`/api/disk?path=${encodeURIComponent(path)}`);
            const file = stepOf(path).files.find((f) => f.path === path);
            const mine = rowsOf(file)
              .filter((r) => r.kind === "given" || r.kind === "typed")
              .map((r) => r.indent + r.text)
              .join("\n");
            setTimeout(
              () =>
                modal(
                  `<h2>${esc(path)}</h2><div class="compare"><div><h4>On disk now</h4><pre>${esc(content ?? "(deleted)")}</pre></div><div><h4>The session's version</h4><pre>${esc(mine)}</pre></div></div>
                   <div class="modal-actions"><button class="btn" data-act="back">Back</button></div>`,
                  { back: () => {} },
                  { className: "wide", onClose: show },
                ),
              0,
            );
          },
        },
        { onClose: () => done(false) },
      );
    show();
  });
}

async function completeFile() {
  const { file, fp } = v;
  const path = file.path;
  if (mode() === "type") {
    const ok = await writeFile();
    if (!ok) {
      fp.done = true;
      await saveProgress(true);
      await refresh();
      return render({ path });
    }
    toast(`Saved <code>${esc(path)}</code>`, "✓");
  }
  fp.done = true;
  await saveProgress(true);
  await refresh();
  sfx.file();
  burst(innerWidth / 2, innerHeight / 2, { count: 50, power: 1.6 });
  setTimeout(() => {
    if (v?.file.path === path) finishFile(path);
  }, 700);
}

/** Files with nothing to type: removed lines only, or a deleted file. */
function showApplyPrompt() {
  if (mode() === "review") return;
  const del = v.file.action === "delete";
  const bar = document.createElement("div");
  bar.className = "apply-bar";
  bar.innerHTML = `<span>${del ? "This file is deleted in this step." : "This file only loses lines in this step."}</span><button class="btn small" id="apply-now">${del ? "Delete the file" : "Remove the lines"}</button>`;
  document.querySelector(".editor").append(bar);
  bar.querySelector("#apply-now").addEventListener("click", () => {
    modal(
      `<h2>${del ? "Delete" : "Update"} ${esc(v.file.path)}?</h2><p class="dim">${del ? "The file will be removed from your project." : "The struck-through lines will be removed from your project."}</p>
       <div class="modal-actions"><button class="btn ghost" data-act="close">Cancel</button><button class="btn" data-act="go">${del ? "Delete it" : "Remove them"}</button></div>`,
      { go: () => completeFile() },
    );
  });
}

/* ---------- review mode ---------- */

function move(delta) {
  if (v?.kind !== "review" || document.querySelector(".overlay")) return;
  const { fp } = v;
  const last = v.stops.length - 1;
  if (delta > 0 && fp.cursor >= last) {
    fp.cursor = v.stops.length;
    v.loom.set(fp.cursor);
    return completeFile();
  }
  const prev = curStopRow();
  fp.cursor = Math.max(0, Math.min(last, fp.cursor + delta));
  if (curStopRow() === prev) return;
  if (delta > 0) {
    const r = v.rows[prev];
    if (r?.note) addHistory(r);
  }
  refreshRow(prev);
  v.loom.set(fp.cursor);
  saveProgress();
  sfx.key();
  renderCurrent(true);
  if (fp.cursor === last) toast("Last changed line in this file. Press ↓ once more to finish it.", "↓");
}

/* ---------- keyboard ---------- */

function focusKeys() {
  if (v && !document.querySelector(".overlay")) $keys.focus({ preventScroll: true });
}

function flushInput() {
  const value = $keys.value;
  $keys.value = "";
  for (const ch of value) {
    if (ch === "\n" || ch === "\r") continue;
    handleChar(SMART_CHARS[ch] ?? ch);
  }
}

$keys.addEventListener("input", (e) => {
  if (!e.isComposing) flushInput();
});
$keys.addEventListener("compositionend", flushInput);
$keys.addEventListener("paste", (e) => {
  e.preventDefault();
  if (v?.kind === "type") toast("No pasting. Typing it is the whole point.", "✋");
});
$keys.addEventListener("keydown", (e) => {
  if (e.isComposing || !v) return;
  if (e.key === "Escape") {
    e.preventDefault();
    return v.kind === "type" ? pause() : backToStep();
  }
  if (v.kind === "review") {
    if (["ArrowDown", "Enter", "j", " "].includes(e.key) || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      move(1);
    } else if (["ArrowUp", "k"].includes(e.key) || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      move(-1);
    }
    return;
  }
  if (v.kind !== "type") return;
  if (e.key === "Backspace") {
    e.preventDefault();
    handleBackspace(e.altKey || e.ctrlKey || e.metaKey);
  } else if (e.key === "Enter") {
    e.preventDefault();
    handleEnter();
  } else if (e.key === "Tab") {
    e.preventDefault();
    e.shiftKey ? toggleBlind() : autocomplete();
  }
});
$keys.addEventListener("blur", () => {
  setTimeout(() => {
    if (!v || (v.kind !== "type" && v.kind !== "review") || document.activeElement === $keys || document.querySelector(".overlay")) return;
    const editor = document.querySelector(".editor");
    if (!editor || editor.querySelector(".focus-veil")) return;
    const veil = document.createElement("button");
    veil.className = "focus-veil";
    veil.innerHTML = `<span>Click here to keep ${v.kind === "type" ? "typing" : "going"}</span>`;
    veil.addEventListener("click", () => {
      veil.remove();
      focusKeys();
    });
    editor.append(veil);
  }, 50);
});
$keys.addEventListener("focus", () => document.querySelector(".focus-veil")?.remove());
document.addEventListener("click", (e) => {
  if (v && !e.target.closest("button, .overlay, a, input, textarea")) focusKeys();
});
