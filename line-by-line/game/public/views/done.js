/* Step summary (stats, try-it commands, reflection) and the final tapestry once every step is done. */

import { go } from "../app.js";
import { burst, confetti, sfx } from "../fx.js";
import { swatch } from "../loom.js";
import { computeStats, fileSize, mode, refresh, saveProgress, sessionDone, stepFilesDone, stepNumber, stepStats, store } from "../store.js";
import { api, esc, md, mdInline, toast } from "../util.js";
import { stepColor } from "./map.js";

const MIN_REFLECTION = 120;
let shown = null;

export function render(params) {
  shown = params;
  if (params.final) return renderFinal();
  const step = store.session.steps.find((s) => s.id === params.stepId);
  const i = stepNumber(step) - 1;
  const next = store.session.steps[i + 1];
  const app = document.getElementById("app");
  const bands = step.files.map((f) => ({ color: stepColor(i), rows: Math.max(2, Math.min(8, fileSize(f))), filled: 99 }));

  app.innerHTML = `
    <div class="screen">
      <div class="done-wrap">
        <div class="trophy">
          <div class="swatch-big">${swatch(bands, { width: 160, height: 110 })}</div>
          <h1>Step ${i + 1} ${mode() === "review" ? "reviewed" : "complete"}</h1>
          <p>${esc(step.title)}</p>
        </div>
        <div class="tiles">${tiles(step)}</div>
        ${filesSection(step)}
        ${tryItSection(step)}
        ${mode() === "type" ? `<section class="section glass" id="reflection"></section>` : ""}
        <div class="actions-row">
          <button class="btn ghost" data-act="map">All steps</button>
          <button class="btn ghost" data-act="step">Back to the files</button>
          ${
            next
              ? `<button class="btn" data-act="next" ${mode() === "type" && !store.state.reflections[step.id] ? "disabled title='Submit your reflection first'" : ""}>Next: ${esc(next.title)} →</button>`
              : sessionDone()
                ? `<button class="btn" data-act="final">See the finished weave →</button>`
                : ""
          }
        </div>
      </div>
    </div>`;

  if (mode() === "type") renderReflection(step);
  app.querySelector('[data-act="map"]').addEventListener("click", () => go("map"));
  app.querySelector('[data-act="step"]').addEventListener("click", () => go("step", { stepId: step.id }));
  app.querySelector('[data-act="next"]')?.addEventListener("click", () => go("step", { stepId: next.id }));
  app.querySelector('[data-act="final"]')?.addEventListener("click", () => go("done", { final: true }));
  app.querySelectorAll("[data-copy]").forEach((b) =>
    b.addEventListener("click", async () => {
      await navigator.clipboard.writeText(b.dataset.copy);
      b.textContent = "Copied!";
      setTimeout(() => (b.textContent = "Copy"), 1400);
    }),
  );
}

export function leave() {
  shown = null;
}

export function onState({ changedSteps }) {
  if (!shown) return;
  if (shown.final) return renderFinal();
  if (changedSteps.includes(shown.stepId) && !document.getElementById("reflect")) {
    const step = store.session.steps.find((s) => s.id === shown.stepId);
    const grade = store.state.stepGrades[step.id];
    if (grade) {
      toast(`Step ${stepNumber(step)} graded: <b>${esc(grade.verdict)}</b>`, grade.verdict === "pass" ? "✓" : "•");
      if (grade.verdict === "pass") confetti(90);
    }
    renderReflection(step);
    if (sessionDone()) render(shown);
  }
}

function tiles(step) {
  const tile = ([value, label], k) => `<div class="tile glass" style="animation-delay:${200 + k * 80}ms"><b>${value}</b><span>${label}</span></div>`;
  if (mode() === "type") {
    const s = stepStats(step);
    const { wpm, accuracy } = computeStats(s);
    return [[wpm, "WPM"], [`${accuracy}%`, "Accuracy"], [s.lines, "Lines"], [s.bestCombo, "Best combo"], [`+${s.xp}`, "XP"]].map(tile).join("");
  }
  if (mode() === "review") {
    const lines = step.files.reduce((n, f) => n + fileSize(f), 0);
    return [[step.files.length, "Files"], [lines, "Changed lines"]].map(tile).join("");
  }
  const grades = step.files.map((f) => store.state.files[f.path]?.grades ?? []);
  const attempts = step.files.reduce((n, f) => n + (store.state.files[f.path]?.submissions ?? 0), 0);
  const firstTry = grades.filter((g) => g[0]?.verdict === "pass").length;
  const scores = grades.map((g) => g.at(-1)?.score).filter((n) => typeof n === "number");
  const reveals = Object.entries(store.state.reveals ?? {}).filter(([p]) => step.files.some((f) => f.path === p)).reduce((n, [, ids]) => n + ids.length, 0);
  return [
    [step.files.length, "Files"],
    [attempts, "Attempts"],
    [firstTry, "First-try passes"],
    [scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : "–", "Avg score"],
    [reveals, "Reveals"],
  ]
    .map(tile)
    .join("");
}

function filesSection(step) {
  if (mode() === "review") return "";
  const applied = store.state.applied;
  const auto = step.autoApplied ?? [];
  return `
    <section class="section glass">
      <h3>Written to your project</h3>
      ${step.files
        .map((f) => {
          const grade = store.state.files[f.path]?.grades?.at(-1);
          const chip = f.path in applied ? `<span class="chip green">${f.action === "delete" ? "deleted" : "saved"}</span>` : `<span class="chip red">not written</span>`;
          return `<div class="cmd"><code>${esc(f.path)}</code><span>${mode() === "learn" && grade ? `<span class="chip">${esc(grade.verdict)} · ${grade.score ?? "–"}</span> ` : ""}${chip}</span></div>`;
        })
        .join("")}
      ${auto.map((a) => `<div class="cmd"><code>${esc(a.path)}</code><span class="chip ${a.path in applied ? "green" : ""}">${esc(a.reason)}</span></div>`).join("")}
    </section>`;
}

function tryItSection(step) {
  if (!step.tryIt?.length) return "";
  return `
    <section class="section glass">
      <h3>Try it</h3>
      <p>Run these in a terminal in your project.</p>
      ${step.tryIt
        .map((t) => {
          const expect = t.expect ? `<small>${mdInline(t.expect)}</small>` : "";
          return t.cmd.startsWith("(")
            ? `<div class="cmd"><div><span>${esc(t.cmd.replace(/^\(|\)$/g, ""))}</span>${expect}</div></div>`
            : `<div class="cmd"><div><code>${esc(t.cmd)}</code>${expect}</div><button class="btn ghost small" data-copy="${esc(t.cmd)}">Copy</button></div>`;
        })
        .join("")}
    </section>`;
}

const reflectionText = (id) => {
  const raw = store.state.reflections[id];
  if (!raw) return "";
  const at = raw.indexOf("## Reflection");
  return at === -1 ? raw : raw.slice(at + "## Reflection".length).trim();
};

function renderReflection(step) {
  const section = document.getElementById("reflection");
  if (!section) return;
  const grade = store.state.stepGrades[step.id];
  const submitted = store.state.reflections[step.id];
  if (grade) {
    const look = { pass: ["✓", "Nailed it"], partial: ["~", "Almost there"], retry: ["↺", "Not quite yet"] }[grade.verdict] ?? ["•", "Graded"];
    section.innerHTML = `
      <h3>Your reflection</h3>
      <div class="verdict ${esc(grade.verdict)}">
        <div class="badge-icon">${look[0]}</div>
        <div><h3>${look[1]}${typeof grade.score === "number" ? ` · ${grade.score}/100` : ""}</h3><div class="feedback">${md(grade.feedback ?? "")}</div></div>
      </div>
      <p class="your-text">${esc(reflectionText(step.id))}</p>
      <button class="btn ghost small" id="rewrite">Rewrite reflection</button>`;
    section.querySelector("#rewrite").addEventListener("click", () => renderReflectionForm(step, reflectionText(step.id)));
    return;
  }
  if (submitted) {
    section.innerHTML = `
      <h3>Your reflection</h3>
      <div class="waiting"><div class="spinner"></div><div>Submitted. Claude is grading it, and the verdict appears here on its own.</div></div>
      <p class="your-text">${esc(reflectionText(step.id))}</p>
      <button class="btn ghost small" id="rewrite">Edit and resubmit</button>`;
    section.querySelector("#rewrite").addEventListener("click", () => renderReflectionForm(step, reflectionText(step.id)));
    return;
  }
  renderReflectionForm(step, "");
}

function renderReflectionForm(step, initial) {
  const section = document.getElementById("reflection");
  const draftKey = `lbl-reflection:${store.session.createdAt}:${step.id}`;
  let draft = initial;
  try {
    draft = localStorage.getItem(draftKey) ?? initial;
  } catch {}
  section.innerHTML = `
    <h3>Explain what you built</h3>
    <div class="feedback dim">${md(step.reflectionPrompt || "In your own words: what did you build in this step, and why is each piece needed?")}</div>
    <label class="sr-only" for="reflect">Your reflection</label>
    <textarea class="reflect" id="reflect" placeholder="In this step I built…">${esc(draft)}</textarea>
    <div class="reflect-foot"><span id="count"></span><button class="btn" id="submit">Submit for grading</button></div>`;
  const area = section.querySelector("#reflect");
  const count = section.querySelector("#count");
  const submit = section.querySelector("#submit");
  const update = () => {
    const n = area.value.trim().length;
    count.textContent = n < MIN_REFLECTION ? `${n} / ${MIN_REFLECTION} characters minimum` : `${n} characters ✓`;
    submit.disabled = n < MIN_REFLECTION;
    try {
      localStorage.setItem(draftKey, area.value);
    } catch {}
  };
  area.addEventListener("input", update);
  update();
  submit.addEventListener("click", async () => {
    submit.disabled = true;
    try {
      const s = stepStats(step);
      const { wpm, accuracy } = computeStats(s);
      await api.post("/api/reflection", { stepId: step.id, text: area.value, stats: { wpm, accuracy, lines: s.lines, assisted: s.assisted ?? 0 } });
      try {
        localStorage.removeItem(draftKey);
      } catch {}
      await refresh();
      store.progress.xp += 50;
      saveProgress();
      toast("Reflection saved · +50 XP. The next step is unlocked.", "✓");
      burst(innerWidth / 2, innerHeight * 0.7, { count: 50, power: 1.5 });
      render({ stepId: step.id });
      document.getElementById("reflection")?.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (error) {
      toast(`Couldn't save: ${esc(error.message)}`, "!");
      submit.disabled = false;
    }
  });
  area.focus();
}

function renderFinal() {
  const steps = store.session.steps;
  const bands = steps.map((s, i) => ({ color: stepColor(i), rows: Math.max(3, Math.min(10, s.files.length * 3)), filled: stepFilesDone(s) ? 99 : 0 }));
  const lines = steps.reduce((n, s) => n + s.files.reduce((m, f) => m + fileSize(f), 0), 0);
  const app = document.getElementById("app");
  const waiting = mode() === "type" ? steps.filter((s) => store.state.reflections[s.id] && !store.state.stepGrades[s.id]).length : 0;
  app.innerHTML = `
    <div class="screen">
      <div class="done-wrap final">
        <div class="trophy">
          <div class="swatch-big">${swatch(bands, { width: 260, height: 200, cols: 22 })}</div>
          <h1>${mode() === "review" ? "Branch reviewed" : "The weave is finished"}</h1>
          <p>${esc(store.session.title)}</p>
        </div>
        <div class="tiles">
          <div class="tile glass"><b>${steps.length}</b><span>Steps</span></div>
          <div class="tile glass"><b>${steps.reduce((n, s) => n + s.files.length, 0)}</b><span>Files</span></div>
          <div class="tile glass"><b>${lines}</b><span>${mode() === "learn" ? "Parts written" : mode() === "review" ? "Changed lines" : "Lines typed"}</span></div>
          ${mode() !== "review" ? `<div class="tile glass"><b>${store.progress.xp}</b><span>Total XP</span></div>` : ""}
        </div>
        ${
          mode() === "review"
            ? ""
            : `<section class="section glass">
                <div class="waiting"><div class="spinner"></div><div>${
                  waiting
                    ? `Claude is grading ${waiting} reflection${waiting > 1 ? "s" : ""}, then it will run your project's checks.`
                    : "Claude is running your project's checks on the real project and will sum up in the chat."
                }</div></div>
              </section>`
        }
        <div class="actions-row"><button class="btn ghost" data-act="map">All steps</button></div>
      </div>
    </div>`;
  app.querySelector('[data-act="map"]').addEventListener("click", () => go("map"));
  if (!store.progress.celebrated) {
    store.progress.celebrated = true;
    saveProgress();
    confetti(220);
    sfx.win();
  }
}
