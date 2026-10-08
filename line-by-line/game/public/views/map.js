import { go } from "../app.js";
import { THREAD_COLORS } from "../fx.js";
import { XP_PER_LEVEL, fileSize, mode, sessionDone, stepPercent, stepStatus, store, walkthrough } from "../store.js";
import { esc } from "../util.js";

const MODE_COPY = {
  type: ["Type mode", "Type the solution yourself, one line at a time. Every line you type is a thread in the weave."],
  learn: ["Learn mode", "Claude laid out the files and signatures. You write the code, and each file is graded on its own."],
  review: ["Review", "Step through this branch's changes line by line, in an order that makes sense."],
};

export const stepColor = (i) => THREAD_COLORS[i % THREAD_COLORS.length];

/** A spool wound with the step's colour. Locked spools are bare. */
export const spool = (i, status, label = i + 1) =>
  `<div class="spool ${status === "locked" ? "locked" : ""}" style="--c:${stepColor(i)}" aria-hidden="true"><span>${label}</span></div>`;

export function render() {
  const { session, progress } = store;
  const [modeName, modeText] = walkthrough()
    ? ["Walkthrough", "Step through how this code works, line by line, in the order it runs."]
    : MODE_COPY[mode()];
  const statuses = session.steps.map(stepStatus);
  const currentIdx = statuses.findIndex((s) => ["available", "progress", "typed"].includes(s));
  const level = Math.floor(progress.xp / XP_PER_LEVEL) + 1;
  const into = progress.xp % XP_PER_LEVEL;
  const overall = Math.round(session.steps.reduce((n, s) => n + stepPercent(s), 0) / session.steps.length);

  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="screen">
      <div class="map">
        <header class="hero">
          <div>
            <p class="eyebrow"><span class="mode-badge ${mode()}${walkthrough() ? " walkthrough" : ""}">${modeName}</span></p>
            <h1>Line by <span>Line</span></h1>
            <h2 class="session-title">${esc(session.title)}</h2>
            ${session.task && session.task !== session.title ? `<p class="task">“${esc(session.task)}”</p>` : ""}
            <p class="lead">${modeText}</p>
          </div>
          <div class="level glass">
            ${
              mode() === "review"
                ? `<div class="level-top"><strong>${overall}% reviewed</strong><span>${session.steps.length} steps</span></div>
                   <div class="bar"><i style="width:${overall}%"></i></div>`
                : `<div class="level-top"><strong>Level ${level}</strong><span>${into} / ${XP_PER_LEVEL} XP</span></div>
                   <div class="bar"><i style="width:${(into / XP_PER_LEVEL) * 100}%"></i></div>`
            }
          </div>
        </header>
        ${sessionDone() ? `<button class="finished glass" data-final>All steps done. See the finished weave →</button>` : ""}
        <div class="path-wrap">
          <svg aria-hidden="true"><path id="trail" fill="none" stroke-width="3" stroke-linecap="round"/></svg>
          <ol class="path" aria-label="Steps">${session.steps.map((s, i) => nodeHtml(s, i, statuses[i], i === currentIdx)).join("")}</ol>
        </div>
      </div>
    </div>`;

  app.querySelectorAll(".node").forEach((el) => el.addEventListener("click", () => go("step", { stepId: el.dataset.step })));
  app.querySelector("[data-final]")?.addEventListener("click", () => go("done", { final: true }));
  requestAnimationFrame(drawTrail);
  addEventListener("resize", drawTrail);
}

export function leave() {
  removeEventListener("resize", drawTrail);
}

export function onState({ changedSteps, changedFiles }) {
  if (changedSteps.length || changedFiles.length) render();
}

function chipFor(step, status) {
  const pct = stepPercent(step);
  const grade = store.state.stepGrades[step.id];
  return {
    locked: `<span class="chip">Locked</span>`,
    available: `<span class="chip accent">Ready</span>`,
    progress: `<span class="chip accent">In progress · ${pct}%</span>`,
    typed: `<span class="chip blue">Write your reflection</span>`,
    submitted: `<span class="chip blue">Awaiting grade</span>`,
    done: `<span class="chip green">${mode() === "review" ? (walkthrough() ? "Read" : "Reviewed") : "Done"}</span>`,
    graded:
      grade?.verdict === "pass"
        ? `<span class="chip green">Passed</span>`
        : grade?.verdict === "partial"
          ? `<span class="chip accent">Almost there</span>`
          : `<span class="chip red">Rewrite reflection</span>`,
  }[status];
}

function nodeHtml(step, i, status, current) {
  const pct = stepPercent(step);
  const size = step.files.reduce((n, f) => n + fileSize(f), 0);
  const unit = mode() === "learn" ? "parts to write" : mode() === "review" ? (walkthrough() ? "lines" : "changed lines") : "lines";
  return `
    <li>
      <button class="node ${current ? "current" : ""}" data-step="${esc(step.id)}" ${status === "locked" ? "disabled" : ""}
        style="animation-delay:${i * 70}ms" aria-label="Step ${i + 1}: ${esc(step.title)}${status === "locked" ? " (locked)" : ""}">
        ${spool(i, status)}
        <div class="node-body">
          <h3>${esc(step.title)}</h3>
          <p>${esc(step.tagline ?? "")}</p>
          <div class="node-meta">${chipFor(step, status)}<span class="chip">${step.files.length} file${step.files.length === 1 ? "" : "s"}</span><span class="chip">${size} ${unit}</span></div>
          ${status === "progress" ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ""}
        </div>
      </button>
    </li>`;
}

function drawTrail() {
  const path = document.getElementById("trail");
  if (!path) return;
  const box = path.closest(".path-wrap").getBoundingClientRect();
  const points = [...document.querySelectorAll(".node .spool")].map((b) => {
    const r = b.getBoundingClientRect();
    return [r.left + r.width / 2 - box.left, r.top + r.height / 2 - box.top];
  });
  const d = points
    .map(([x, y], i) => {
      if (i === 0) return `M ${x} ${y}`;
      const [px, py] = points[i - 1];
      const my = (py + y) / 2;
      return `C ${px} ${my}, ${x} ${my}, ${x} ${y}`;
    })
    .join(" ");
  path.setAttribute("d", d);
}
